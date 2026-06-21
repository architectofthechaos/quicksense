package k8s_test

import (
	"context"
	"testing"

	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"

	k8s "github.com/deepiq/quicksense/api/internal/k8s"
)

// newFakeDyn builds a fake dynamic client pre-registered with the SparkConnect GVR.
func newFakeDyn() *dynamicfake.FakeDynamicClient {
	scheme := runtime.NewScheme()
	return dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme,
		map[schema.GroupVersionResource]string{k8s.SparkConnectGVR: "SparkConnectList"})
}

// --- B10 ---

func TestCreateProducesCRWithExpectedSpec(t *testing.T) {
	ctx := context.Background()
	fdyn := newFakeDyn()
	client := k8s.NewSparkConnectClient(fdyn, "quicksense")

	spec := k8s.ClusterSpec{
		Name:           "demo",
		Image:          "quicksense-spark:dev",
		Executors:      2,
		ServiceAccount: "spark-operator-spark",
		SparkConf: map[string]string{
			"spark.sql.defaultCatalog": "quicksense",
			"spark.sql.extensions":     "org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions",
		},
	}

	crName, err := client.Create(ctx, spec)
	if err != nil {
		t.Fatalf("Create returned error: %v", err)
	}
	if crName != "demo" {
		t.Fatalf("expected crName=demo, got %q", crName)
	}

	// Fetch the created object from the fake store.
	got, err := fdyn.Resource(k8s.SparkConnectGVR).Namespace("quicksense").Get(ctx, "demo", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("failed to fetch CR from fake: %v", err)
	}

	// apiVersion
	av, _, _ := unstructured.NestedString(got.Object, "apiVersion")
	if av != "sparkoperator.k8s.io/v1alpha1" {
		t.Errorf("apiVersion: got %q, want sparkoperator.k8s.io/v1alpha1", av)
	}
	// kind
	kk, _, _ := unstructured.NestedString(got.Object, "kind")
	if kk != "SparkConnect" {
		t.Errorf("kind: got %q, want SparkConnect", kk)
	}

	// spec.image must NOT exist at top-level (live validation: top-level image
	// leaves pods with imagePullPolicy: Always which causes ImagePullBackOff).
	if _, found, _ := unstructured.NestedString(got.Object, "spec", "image"); found {
		t.Errorf("spec.image must be absent from top-level (use template containers instead)")
	}

	// spec.server.template.spec.containers — driver container (use NestedSlice;
	// integer-keyed NestedString does not work for slice elements in unstructured).
	serverContainers, found, _ := unstructured.NestedSlice(got.Object, "spec", "server", "template", "spec", "containers")
	if !found || len(serverContainers) == 0 {
		t.Fatalf("spec.server.template.spec.containers missing or empty")
	}
	sc0, ok := serverContainers[0].(map[string]interface{})
	if !ok {
		t.Fatalf("server containers[0] is not a map: %T", serverContainers[0])
	}
	if sc0["image"] != "quicksense-spark:dev" {
		t.Errorf("server container image: got %v, want quicksense-spark:dev", sc0["image"])
	}
	if sc0["imagePullPolicy"] != "IfNotPresent" {
		t.Errorf("server container imagePullPolicy: got %v, want IfNotPresent", sc0["imagePullPolicy"])
	}

	// spec.server.template.spec.serviceAccountName
	sa, _, _ := unstructured.NestedString(got.Object, "spec", "server", "template", "spec", "serviceAccountName")
	if sa != "spark-operator-spark" {
		t.Errorf("serviceAccountName: got %q, want spark-operator-spark", sa)
	}

	// spec.executor.instances
	inst, found, err3 := unstructured.NestedInt64(got.Object, "spec", "executor", "instances")
	if err3 != nil || !found {
		t.Fatalf("spec.executor.instances missing or error: found=%v err=%v", found, err3)
	}
	if inst != 2 {
		t.Errorf("spec.executor.instances: got %d, want 2", inst)
	}

	// spec.executor.template.spec.containers — executor container
	execContainers, found, _ := unstructured.NestedSlice(got.Object, "spec", "executor", "template", "spec", "containers")
	if !found || len(execContainers) == 0 {
		t.Fatalf("spec.executor.template.spec.containers missing or empty")
	}
	ec0, ok := execContainers[0].(map[string]interface{})
	if !ok {
		t.Fatalf("executor containers[0] is not a map: %T", execContainers[0])
	}
	if ec0["image"] != "quicksense-spark:dev" {
		t.Errorf("executor container image: got %v, want quicksense-spark:dev", ec0["image"])
	}
	if ec0["imagePullPolicy"] != "IfNotPresent" {
		t.Errorf("executor container imagePullPolicy: got %v, want IfNotPresent", ec0["imagePullPolicy"])
	}

	// spec.sparkConf["spark.sql.defaultCatalog"] must equal "quicksense"
	defaultCatalog, found, _ := unstructured.NestedString(got.Object, "spec", "sparkConf", "spark.sql.defaultCatalog")
	if !found {
		t.Errorf("spec.sparkConf[spark.sql.defaultCatalog] missing")
	} else if defaultCatalog != "quicksense" {
		t.Errorf("spark.sql.defaultCatalog: got %q, want quicksense", defaultCatalog)
	}
}

// --- B11 ---

func TestGetReadsStatusPhase(t *testing.T) {
	ctx := context.Background()
	fdyn := newFakeDyn()
	client := k8s.NewSparkConnectClient(fdyn, "quicksense")

	_, err := client.Create(ctx, k8s.ClusterSpec{
		Name:      "sc-status",
		Image:     "quicksense-spark:dev",
		Executors: 1,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Inject .status.state via the fake's Update.
	obj, err := fdyn.Resource(k8s.SparkConnectGVR).Namespace("quicksense").Get(ctx, "sc-status", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("Get from fake: %v", err)
	}
	if setErr := unstructured.SetNestedField(obj.Object, "ReadyState", "status", "state"); setErr != nil {
		t.Fatalf("SetNestedField: %v", setErr)
	}
	if _, updateErr := fdyn.Resource(k8s.SparkConnectGVR).Namespace("quicksense").Update(ctx, obj, metav1.UpdateOptions{}); updateErr != nil {
		t.Fatalf("fake Update: %v", updateErr)
	}

	status, err := client.Get(ctx, "sc-status")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if status.Name != "sc-status" {
		t.Errorf("Name: got %q, want sc-status", status.Name)
	}
	if status.Phase != "ReadyState" {
		t.Errorf("Phase: got %q, want ReadyState", status.Phase)
	}
	if !status.Ready {
		t.Errorf("Ready: got false, want true (phase contains 'ready')")
	}
}

// TestGetNotReadyPhaseIsNotReady guards against a substring false-positive:
// the Kubeflow Spark Operator emits .status.state="NotReady" while a cluster is
// still settling. A naive strings.Contains(lower,"ready") match treats that as
// Ready, which defeats the UI's "watch it become Ready" flow. Verified live:
// the operator reports "NotReady" then "Ready".
func TestGetNotReadyPhaseIsNotReady(t *testing.T) {
	ctx := context.Background()
	fdyn := newFakeDyn()
	client := k8s.NewSparkConnectClient(fdyn, "quicksense")

	_, err := client.Create(ctx, k8s.ClusterSpec{Name: "sc-notready", Image: "quicksense-spark:dev", Executors: 1})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	obj, err := fdyn.Resource(k8s.SparkConnectGVR).Namespace("quicksense").Get(ctx, "sc-notready", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("Get from fake: %v", err)
	}
	if setErr := unstructured.SetNestedField(obj.Object, "NotReady", "status", "state"); setErr != nil {
		t.Fatalf("SetNestedField: %v", setErr)
	}
	if _, updateErr := fdyn.Resource(k8s.SparkConnectGVR).Namespace("quicksense").Update(ctx, obj, metav1.UpdateOptions{}); updateErr != nil {
		t.Fatalf("fake Update: %v", updateErr)
	}

	status, err := client.Get(ctx, "sc-notready")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if status.Phase != "NotReady" {
		t.Errorf("Phase: got %q, want NotReady", status.Phase)
	}
	if status.Ready {
		t.Errorf("Ready: got true, want false ('NotReady' must not count as ready)")
	}
}

// --- 4b: production pod resources, autoscaling, env, tags ---

func firstContainer(t *testing.T, obj *unstructured.Unstructured, path ...string) map[string]interface{} {
	t.Helper()
	cs, found, err := unstructured.NestedSlice(obj.Object, path...)
	if err != nil || !found || len(cs) == 0 {
		t.Fatalf("containers missing at %v: found=%v err=%v", path, found, err)
	}
	m, ok := cs[0].(map[string]interface{})
	if !ok {
		t.Fatalf("container[0] not a map: %T", cs[0])
	}
	return m
}

func assertResource(t *testing.T, c map[string]interface{}, kind, res, want string) {
	t.Helper()
	r, _ := c["resources"].(map[string]interface{})
	k, _ := r[kind].(map[string]interface{})
	if got, _ := k[res].(string); got != want {
		t.Errorf("resources.%s.%s: got %q, want %q", kind, res, got, want)
	}
}

func assertEnv(t *testing.T, c map[string]interface{}, name, want string) {
	t.Helper()
	env, _ := c["env"].([]interface{})
	for _, e := range env {
		m, _ := e.(map[string]interface{})
		if m["name"] == name {
			if m["value"] != want {
				t.Errorf("env %s: got %v, want %q", name, m["value"], want)
			}
			return
		}
	}
	t.Errorf("env var %q not found on container", name)
}

func TestCreateProducesProductionResourcesAndAutoscaling(t *testing.T) {
	ctx := context.Background()
	fdyn := newFakeDyn()
	client := k8s.NewSparkConnectClient(fdyn, "quicksense")

	spec := k8s.ClusterSpec{
		Name:      "prod",
		Image:     "quicksense-spark:dev",
		WorkerMin: 2,
		WorkerMax: 5,
		Driver:    k8s.Resources{CPURequest: "1", CPULimit: "2", MemoryRequest: "2Gi", MemoryLimit: "4Gi"},
		Executor:  k8s.Resources{CPURequest: "2", CPULimit: "4", MemoryRequest: "4Gi", MemoryLimit: "8Gi"},
		Env:       map[string]string{"FOO": "bar"},
		Tags:      map[string]string{"team": "data"},
		SparkConf: map[string]string{"spark.sql.defaultCatalog": "quicksense"},
	}
	if _, err := client.Create(ctx, spec); err != nil {
		t.Fatalf("Create: %v", err)
	}
	got, err := fdyn.Resource(k8s.SparkConnectGVR).Namespace("quicksense").Get(ctx, "prod", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get: %v", err)
	}

	// executor.instances seeds from the min worker count.
	if inst, _, _ := unstructured.NestedInt64(got.Object, "spec", "executor", "instances"); inst != 2 {
		t.Errorf("executor.instances: got %d, want 2", inst)
	}

	// min<max ⇒ dynamic allocation wired into sparkConf.
	for k, want := range map[string]string{
		"spark.dynamicAllocation.enabled":      "true",
		"spark.dynamicAllocation.minExecutors": "2",
		"spark.dynamicAllocation.maxExecutors": "5",
	} {
		v, found, _ := unstructured.NestedString(got.Object, "spec", "sparkConf", k)
		if !found || v != want {
			t.Errorf("sparkConf[%s]: got %q (found=%v), want %q", k, v, found, want)
		}
	}
	// user sparkConf preserved.
	if v, _, _ := unstructured.NestedString(got.Object, "spec", "sparkConf", "spark.sql.defaultCatalog"); v != "quicksense" {
		t.Errorf("user sparkConf clobbered: defaultCatalog=%q", v)
	}

	// driver resources + env.
	dc := firstContainer(t, got, "spec", "server", "template", "spec", "containers")
	assertResource(t, dc, "requests", "cpu", "1")
	assertResource(t, dc, "limits", "memory", "4Gi")
	assertEnv(t, dc, "FOO", "bar")

	// executor resources + env.
	ec := firstContainer(t, got, "spec", "executor", "template", "spec", "containers")
	assertResource(t, ec, "requests", "memory", "4Gi")
	assertResource(t, ec, "limits", "cpu", "4")
	assertEnv(t, ec, "FOO", "bar")

	// tags surface as annotations (arbitrary values, no label-syntax constraints).
	ann, _, _ := unstructured.NestedStringMap(got.Object, "metadata", "annotations")
	if ann["quicksense.io/team"] != "data" {
		t.Errorf("tag annotation quicksense.io/team: got %q, want data", ann["quicksense.io/team"])
	}
}

func TestDeleteRemovesCR(t *testing.T) {
	ctx := context.Background()
	fdyn := newFakeDyn()
	client := k8s.NewSparkConnectClient(fdyn, "quicksense")

	_, err := client.Create(ctx, k8s.ClusterSpec{
		Name:      "sc-del",
		Image:     "quicksense-spark:dev",
		Executors: 1,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := client.Delete(ctx, "sc-del"); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	// Verify the CR is gone.
	_, fetchErr := fdyn.Resource(k8s.SparkConnectGVR).Namespace("quicksense").Get(ctx, "sc-del", metav1.GetOptions{})
	if fetchErr == nil {
		t.Fatal("expected NotFound after Delete, got nil error")
	}
	if !errors.IsNotFound(fetchErr) {
		t.Fatalf("expected IsNotFound, got: %v", fetchErr)
	}
}
