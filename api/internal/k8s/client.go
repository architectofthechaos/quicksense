// SPDX-License-Identifier: Apache-2.0

package k8s

import (
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// restConfig builds a *rest.Config from a kubeconfig path, or in-cluster config
// (pod ServiceAccount) when the path is empty.
func restConfig(kubeconfigPath string) (*rest.Config, error) {
	if kubeconfigPath == "" {
		return rest.InClusterConfig()
	}
	return clientcmd.BuildConfigFromFlags("", kubeconfigPath)
}

// NewDynamicClient returns a dynamic.Interface ready for use.
// If kubeconfigPath is empty, in-cluster config is used (pod ServiceAccount).
// Otherwise the given kubeconfig file is loaded (local dev / kind).
func NewDynamicClient(kubeconfigPath string) (dynamic.Interface, error) {
	restCfg, err := restConfig(kubeconfigPath)
	if err != nil {
		return nil, err
	}
	return dynamic.NewForConfig(restCfg)
}

// NewClientset returns a typed kubernetes.Interface (for pod logs/events) built
// from the same config source as NewDynamicClient.
func NewClientset(kubeconfigPath string) (kubernetes.Interface, error) {
	restCfg, err := restConfig(kubeconfigPath)
	if err != nil {
		return nil, err
	}
	return kubernetes.NewForConfig(restCfg)
}
