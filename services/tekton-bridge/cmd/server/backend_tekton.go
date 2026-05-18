//go:build tekton

package main

import (
	"log"
	"os"
	"strings"

	"github.com/company/deploy-management/services/tekton-bridge/internal/backend"
)

func selectBackend() backend.Backend {
	if strings.ToLower(os.Getenv("TEKTON_BRIDGE_BACKEND")) == "simulated" {
		return backend.NewSimulatedBackend()
	}
	namespace := os.Getenv("TEKTON_BRIDGE_NAMESPACE")
	b, err := backend.NewTektonBackend(namespace)
	if err != nil {
		log.Fatalf("init tekton backend: %v", err)
	}
	return b
}
