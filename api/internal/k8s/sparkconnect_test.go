package k8s_test

import (
	"context"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/api/errors"
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
		Name:      "demo",
		Image:     "quicksense-spark:dev",
		Executors: 2,
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
	// spec.spark.image
	img, found, err2 := unstructured.NestedString(got.Object, "spec", "spark", "image")
	if err2 != nil || !found {
		t.Fatalf("spec.spark.image missing or error: found=%v err=%v", found, err2)
	}
	if img != "quicksense-spark:dev" {
		t.Errorf("spec.spark.image: got %q, want quicksense-spark:dev", img)
	}
	// spec.executor.instances
	inst, found, err3 := unstructured.NestedInt64(got.Object, "spec", "executor", "instances")
	if err3 != nil || !found {
		t.Fatalf("spec.executor.instances missing or error: found=%v err=%v", found, err3)
	}
	if inst != 2 {
		t.Errorf("spec.executor.instances: got %d, want 2", inst)
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
