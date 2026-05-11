//go:build tekton

// Package backend's TektonBackend bridges to a Kubernetes cluster running
// tektoncd/pipeline. Build with `go build -tags tekton ./...` to enable.
//
// This file intentionally lives behind a build tag so the default binary does
// not pull in client-go or tekton client dependencies. Add the corresponding
// `require` lines to go.mod when enabling.
package backend

import (
	"context"
	"errors"

	"github.com/company/deploy-management/services/tekton-bridge/internal/domain"
)

// TektonBackend is a stub. Wire to tektoncd/pipeline client-go in a follow-up
// sprint that targets a real cluster.
type TektonBackend struct {
	Namespace string
	// kubeClient kubernetes.Interface
	// tektonClient versioned.Interface
}

// NewTektonBackend constructs a TektonBackend. Returns error if the kube
// configuration cannot be loaded.
func NewTektonBackend(namespace string) (*TektonBackend, error) {
	if namespace == "" {
		namespace = "default"
	}
	return &TektonBackend{Namespace: namespace}, nil
}

func (t *TektonBackend) Name() domain.Backend { return domain.BackendTekton }

func (t *TektonBackend) Start(_ context.Context, _ domain.StartRunInput) (domain.RunHandle, error) {
	return domain.RunHandle{}, errors.New("tekton backend not yet implemented; follow-up sprint")
}

func (t *TektonBackend) Status(_ context.Context, _ domain.RunHandle) (domain.RunStatus, error) {
	return domain.RunStatus{}, errors.New("tekton backend not yet implemented")
}

func (t *TektonBackend) Cancel(_ context.Context, _ domain.RunHandle) error {
	return errors.New("tekton backend not yet implemented")
}

func (t *TektonBackend) Events(_ context.Context, _ domain.RunHandle) (<-chan domain.RunEvent, error) {
	return nil, errors.New("tekton backend not yet implemented")
}
