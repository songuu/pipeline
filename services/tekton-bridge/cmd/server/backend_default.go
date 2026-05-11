//go:build !tekton

package main

import (
	"github.com/company/deploy-management/services/tekton-bridge/internal/backend"
)

func selectBackend() backend.Backend {
	return backend.NewSimulatedBackend()
}
