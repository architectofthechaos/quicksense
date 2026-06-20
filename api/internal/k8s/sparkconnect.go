// Package k8s provides a client for managing SparkConnect custom resources
// on a Kubernetes cluster via the dynamic client-go interface.
// The SparkConnect CRD is owned by the Kubeflow Spark Operator.
//
// NOTE: SparkConnectGVR.Version ("v1alpha1") and the .status.state field path
// are ASSUMPTIONS reconciled against the installed CRD in task B17.
// Keep them in single, easily-editable spots (SparkConnectGVR + statusStatePath).
package k8s

import (
	"context"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
)

// SparkConnectGVR is the GroupVersionResource for SparkConnect CRs.
// VERSION: "v1alpha1" is an assumption; reconcile with the installed CRD in B17.
var SparkConnectGVR = schema.GroupVersionResource{
	Group:    "sparkoperator.k8s.io",
	Version:  "v1alpha1",
	Resource: "sparkconnects",
}

// statusStatePath is the field path for the cluster state inside .status.
// Isolated here so B17 can update it in one place.
var statusStatePath = []string{"status", "state"}

// ClusterSpec describes the desired SparkConnect cluster. The target namespace
// is owned by the client (NewSparkConnectClient), not the spec: every CR is
// created, read, and deleted in that single namespace (the one the operator
// watches), so Create/Get/Delete stay consistent.
type ClusterSpec struct {
	Name           string
	Image          string
	Executors      int32
	ServiceAccount string            // Kubernetes ServiceAccount for the driver pod
	SparkConf      map[string]string // Iceberg / catalog sparkConf entries
}

// ClusterStatus is the observed state of a SparkConnect cluster.
type ClusterStatus struct {
	Name  string
	Phase string
	Ready bool
}

// SparkConnectClient manages SparkConnect CRs.
type SparkConnectClient interface {
	// Create provisions a new SparkConnect CR and returns the CR name.
	Create(ctx context.Context, s ClusterSpec) (crName string, err error)
	// Get returns the observed status of an existing CR.
	Get(ctx context.Context, name string) (ClusterStatus, error)
	// Delete removes a SparkConnect CR.
	Delete(ctx context.Context, name string) error
}

// Compile-time interface check.
var _ SparkConnectClient = (*dynamicClient)(nil)

type dynamicClient struct {
	dyn       dynamic.Interface
	namespace string
}

// NewSparkConnectClient returns a SparkConnectClient backed by the given
// dynamic client. namespace is authoritative: all CRs are created, read, and
// deleted in it.
func NewSparkConnectClient(dyn dynamic.Interface, namespace string) SparkConnectClient {
	return &dynamicClient{dyn: dyn, namespace: namespace}
}

// buildCR constructs the unstructured SparkConnect CR from a ClusterSpec.
//
// LIVE-VALIDATED SHAPE (Spark Operator 2.5.1 + kind):
// The top-level spec.image shortcut leaves pods with imagePullPolicy: Always
// which causes ImagePullBackOff for kind-loaded images. The full template form
// is required: spec.server.template.spec and spec.executor.template.spec must
// each carry their own container entry with imagePullPolicy: IfNotPresent.
//
// The operator names the gRPC Service <cr-name>-server on port 15002.
func buildCR(s ClusterSpec, namespace string) *unstructured.Unstructured {
	// Build sparkConf as map[string]interface{} for unstructured encoding.
	sparkConf := make(map[string]interface{}, len(s.SparkConf))
	for k, v := range s.SparkConf {
		sparkConf[k] = v
	}

	// Container entries — one for the driver (server) and one for the executor.
	driverContainer := map[string]interface{}{
		"name":            "spark-kubernetes-driver",
		"image":           s.Image,
		"imagePullPolicy": "IfNotPresent",
	}
	executorContainer := map[string]interface{}{
		"name":            "spark-kubernetes-executor",
		"image":           s.Image,
		"imagePullPolicy": "IfNotPresent",
	}

	// server spec — serviceAccountName + containers list.
	serverTemplateSpec := map[string]interface{}{
		"containers": []interface{}{driverContainer},
	}
	if s.ServiceAccount != "" {
		serverTemplateSpec["serviceAccountName"] = s.ServiceAccount
	}

	return &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": SparkConnectGVR.Group + "/" + SparkConnectGVR.Version,
			"kind":       "SparkConnect",
			"metadata": map[string]interface{}{
				"name":      s.Name,
				"namespace": namespace,
				"labels": map[string]interface{}{
					"app.kubernetes.io/managed-by": "quicksense",
				},
			},
			// Full template form required for kind-loaded images.
			// sparkVersion is required by the CRD; sparkConf carries catalog wiring.
			"spec": map[string]interface{}{
				"sparkVersion": "4.0.3",
				"sparkConf":    sparkConf,
				"server": map[string]interface{}{
					"template": map[string]interface{}{
						"spec": serverTemplateSpec,
					},
				},
				"executor": map[string]interface{}{
					"instances": int64(s.Executors),
					"template": map[string]interface{}{
						"spec": map[string]interface{}{
							"containers": []interface{}{executorContainer},
						},
					},
				},
			},
		},
	}
}

// Create builds and submits a SparkConnect CR, returning the created CR's name.
func (c *dynamicClient) Create(ctx context.Context, s ClusterSpec) (string, error) {
	cr := buildCR(s, c.namespace)
	created, err := c.dyn.Resource(SparkConnectGVR).Namespace(c.namespace).Create(ctx, cr, metav1.CreateOptions{})
	if err != nil {
		return "", err
	}
	return created.GetName(), nil
}

// Get fetches a SparkConnect CR and maps .status.state to ClusterStatus.
// A missing or empty status is tolerated (Phase "", Ready false).
func (c *dynamicClient) Get(ctx context.Context, name string) (ClusterStatus, error) {
	obj, err := c.dyn.Resource(SparkConnectGVR).Namespace(c.namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return ClusterStatus{}, err
	}
	// Read .status.state — field path isolated in statusStatePath for B17.
	phase, _, _ := unstructured.NestedString(obj.Object, statusStatePath...)
	return ClusterStatus{
		Name:  name,
		Phase: phase,
		Ready: isReadyState(phase),
	}, nil
}

// isReadyState reports whether a SparkConnect .status.state indicates a live,
// servable cluster. It is lenient about ready-ish state names (e.g. "Ready",
// "ReadyState") but must NOT match the operator's transient "NotReady"/"Not
// Ready" states — verified live, the operator emits "NotReady" then "Ready".
func isReadyState(phase string) bool {
	normalized := strings.NewReplacer(" ", "", "-", "", "_", "").Replace(strings.ToLower(phase))
	return strings.Contains(normalized, "ready") && !strings.Contains(normalized, "notready")
}

// Delete removes the named SparkConnect CR.
func (c *dynamicClient) Delete(ctx context.Context, name string) error {
	return c.dyn.Resource(SparkConnectGVR).Namespace(c.namespace).Delete(ctx, name, metav1.DeleteOptions{})
}
