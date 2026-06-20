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

// ClusterSpec describes the desired SparkConnect cluster.
type ClusterSpec struct {
	Name      string
	Image     string
	Namespace string
	Executors int32
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
// dynamic client. namespace is the default namespace for CRs whose
// ClusterSpec.Namespace is empty.
func NewSparkConnectClient(dyn dynamic.Interface, namespace string) SparkConnectClient {
	return &dynamicClient{dyn: dyn, namespace: namespace}
}

// ns resolves the effective namespace: use spec.Namespace when set, else the
// client's default namespace.
func (c *dynamicClient) ns(specNS string) string {
	if specNS != "" {
		return specNS
	}
	return c.namespace
}

// buildCR constructs the unstructured SparkConnect CR from a ClusterSpec.
// Isolated into its own function so B17 can reconcile the spec schema against
// the installed CRD without touching Create.
func buildCR(s ClusterSpec, namespace string) *unstructured.Unstructured {
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
			"spec": map[string]interface{}{
				"sparkVersion": "4.0.3",
				"spark": map[string]interface{}{
					"image": s.Image,
				},
				"executor": map[string]interface{}{
					"instances": int64(s.Executors),
				},
			},
		},
	}
}

// Create builds and submits a SparkConnect CR, returning the created CR's name.
func (c *dynamicClient) Create(ctx context.Context, s ClusterSpec) (string, error) {
	ns := c.ns(s.Namespace)
	cr := buildCR(s, ns)
	created, err := c.dyn.Resource(SparkConnectGVR).Namespace(ns).Create(ctx, cr, metav1.CreateOptions{})
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
		Ready: strings.Contains(strings.ToLower(phase), "ready"),
	}, nil
}

// Delete removes the named SparkConnect CR.
func (c *dynamicClient) Delete(ctx context.Context, name string) error {
	return c.dyn.Resource(SparkConnectGVR).Namespace(c.namespace).Delete(ctx, name, metav1.DeleteOptions{})
}
