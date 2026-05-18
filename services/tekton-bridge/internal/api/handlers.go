// Package api hosts the HTTP handlers consumed by the Nest API.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/company/deploy-management/services/tekton-bridge/internal/backend"
	"github.com/company/deploy-management/services/tekton-bridge/internal/domain"
)

// Handler wires HTTP routes to a Backend implementation.
type Handler struct {
	backend backend.Backend
}

// NewHandler constructs a handler bound to the supplied backend.
func NewHandler(b backend.Backend) *Handler {
	return &Handler{backend: b}
}

// Health returns 200 once the bridge is ready.
func (h *Handler) Health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"backend": string(h.backend.Name()),
	})
}

// Capabilities GET /v1/capabilities
func (h *Handler) Capabilities(w http.ResponseWriter, r *http.Request) {
	capabilities, err := h.backend.Capabilities(r.Context())
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, capabilities)
}

// Preflight POST /v1/preflight
func (h *Handler) Preflight(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxCreateRunBodyBytes)
	var request domain.PreflightRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid JSON: %w", err))
		return
	}
	report, err := h.backend.Preflight(r.Context(), request)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, report)
}

// maxCreateRunBodyBytes caps StartRunInput payloads at 1 MiB to bound the
// memory the SimulatedBackend allocates when materializing stages.
const maxCreateRunBodyBytes = 1 << 20

// maxStartRunStages bounds how many stages a single run can declare. Beyond
// this we reject the request rather than allocate per-stage state.
const maxStartRunStages = 64

// CreateRun POST /v1/runs
func (h *Handler) CreateRun(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxCreateRunBodyBytes)
	var input domain.StartRunInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid JSON: %w", err))
		return
	}
	if len(input.Stages) > maxStartRunStages {
		writeError(w, http.StatusBadRequest, fmt.Errorf("too many stages: %d > %d", len(input.Stages), maxStartRunStages))
		return
	}
	handle, err := h.backend.Start(r.Context(), input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusAccepted, handle)
}

// GetRun GET /v1/runs/:runId
func (h *Handler) GetRun(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runId")
	status, err := h.backend.Status(r.Context(), domain.RunHandle{RunID: runID, Backend: h.backend.Name()})
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, status)
}

// CancelRun POST /v1/runs/:runId/cancel
func (h *Handler) CancelRun(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runId")
	if err := h.backend.Cancel(r.Context(), domain.RunHandle{RunID: runID, Backend: h.backend.Name()}); err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"runId": runID, "status": string(domain.StatusCanceled)})
}

// GetTaskRun GET /v1/runs/:runId/taskruns/:taskRunName
func (h *Handler) GetTaskRun(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runId")
	taskRunName := chi.URLParam(r, "taskRunName")
	detail, err := h.backend.TaskRunDetail(r.Context(), domain.RunHandle{RunID: runID, Backend: h.backend.Name()}, taskRunName)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

// GetTaskRunLogs GET /v1/runs/:runId/taskruns/:taskRunName/logs?step=name
func (h *Handler) GetTaskRunLogs(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runId")
	taskRunName := chi.URLParam(r, "taskRunName")
	stepName := r.URL.Query().Get("step")
	logs, err := h.backend.TaskRunLogs(r.Context(), domain.RunHandle{RunID: runID, Backend: h.backend.Name()}, taskRunName, stepName)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, logs)
}

// StreamEvents GET /v1/runs/:runId/events (SSE)
func (h *Handler) StreamEvents(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runId")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, errors.New("streaming not supported"))
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	events, err := h.backend.Events(ctx, domain.RunHandle{RunID: runID, Backend: h.backend.Name()})
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-events:
			if !ok {
				return
			}
			payload, err := json.Marshal(event)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "data: %s\n\n", payload)
			flusher.Flush()
		case <-heartbeat.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
