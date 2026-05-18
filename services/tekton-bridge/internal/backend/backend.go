// Package backend defines the Backend interface and the default in-memory
// SimulatedBackend. The TektonBackend implementation lives in tekton.go and
// is gated by the `tekton` build tag so the default binary does not depend
// on Kubernetes client libraries.
package backend

import (
	"context"

	"github.com/company/deploy-management/services/tekton-bridge/internal/domain"
)

// Backend is the executor port. Adapters must be safe for concurrent use.
type Backend interface {
	Name() domain.Backend
	Capabilities(ctx context.Context) (domain.BridgeCapabilities, error)
	Preflight(ctx context.Context, request domain.PreflightRequest) (domain.PreflightReport, error)
	Start(ctx context.Context, input domain.StartRunInput) (domain.RunHandle, error)
	Status(ctx context.Context, handle domain.RunHandle) (domain.RunStatus, error)
	Cancel(ctx context.Context, handle domain.RunHandle) error
	Events(ctx context.Context, handle domain.RunHandle) (<-chan domain.RunEvent, error)
	TaskRunDetail(ctx context.Context, handle domain.RunHandle, taskRunName string) (domain.TaskRunDetail, error)
	TaskRunLogs(ctx context.Context, handle domain.RunHandle, taskRunName string, stepName string) (domain.TaskRunLogs, error)
}
