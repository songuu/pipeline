// Tekton bridge entrypoint.
//
// Default backend: SimulatedBackend (no Kubernetes required).
// To enable the real Tekton backend rebuild with: go build -tags tekton ./...
// and set TEKTON_BRIDGE_BACKEND=tekton.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/company/deploy-management/services/tekton-bridge/internal/api"
)

func main() {
	addr := envOr("TEKTON_BRIDGE_ADDR", ":5050")

	b := selectBackend()
	router := api.NewRouter(api.NewHandler(b))

	server := &http.Server{
		Addr:              addr,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("tekton-bridge listening on %s (backend=%s)", addr, b.Name())
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	<-ctx.Done()
	log.Printf("shutdown signal received")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

func envOr(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok && value != "" {
		return value
	}
	return fallback
}
