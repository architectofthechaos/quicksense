// SPDX-License-Identifier: Apache-2.0

package k8s

import (
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// NewDynamicClient returns a dynamic.Interface ready for use.
// If kubeconfigPath is empty, in-cluster config is used (pod ServiceAccount).
// Otherwise the given kubeconfig file is loaded (local dev / kind).
func NewDynamicClient(kubeconfigPath string) (dynamic.Interface, error) {
	var (
		restCfg *rest.Config
		err     error
	)
	if kubeconfigPath == "" {
		restCfg, err = rest.InClusterConfig()
	} else {
		restCfg, err = clientcmd.BuildConfigFromFlags("", kubeconfigPath)
	}
	if err != nil {
		return nil, err
	}
	return dynamic.NewForConfig(restCfg)
}
