package api

import (
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

// NewRouter wires the bridge HTTP routes.
func NewRouter(h *Handler) chi.Router {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins(),
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/healthz", h.Health)
	r.Get("/v1/capabilities", h.Capabilities)
	r.Post("/v1/preflight", h.Preflight)
	r.Route("/v1/runs", func(r chi.Router) {
		r.Post("/", h.CreateRun)
		r.Route("/{runId}", func(r chi.Router) {
			r.Get("/", h.GetRun)
			r.Post("/cancel", h.CancelRun)
			r.Get("/events", h.StreamEvents)
			r.Route("/taskruns/{taskRunName}", func(r chi.Router) {
				r.Get("/", h.GetTaskRun)
				r.Get("/logs", h.GetTaskRunLogs)
			})
		})
	})

	return r
}

// allowedOrigins reads TEKTON_BRIDGE_ALLOWED_ORIGINS as a comma-separated list.
// Default is empty (no CORS allowed) since the only intended caller is the Nest
// API doing server-to-server requests where CORS does not apply.
func allowedOrigins() []string {
	raw := strings.TrimSpace(os.Getenv("TEKTON_BRIDGE_ALLOWED_ORIGINS"))
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
