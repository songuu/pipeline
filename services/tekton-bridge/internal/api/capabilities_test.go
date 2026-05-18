package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/company/deploy-management/services/tekton-bridge/internal/backend"
)

func TestCapabilitiesMakeSimulatedBackendExplicitlyNonReal(t *testing.T) {
	t.Parallel()

	router := NewRouter(NewHandler(backend.NewSimulatedBackend()))
	request := httptest.NewRequest(http.MethodGet, "/v1/capabilities", nil)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["backend"] != "simulated" {
		t.Fatalf("expected backend simulated, got %#v", payload["backend"])
	}
	kubernetes := objectField(t, payload, "kubernetes")
	if kubernetes["reachable"] != false {
		t.Fatalf("expected unreachable kubernetes for simulated backend, got %#v", kubernetes["reachable"])
	}
	tekton := objectField(t, payload, "tekton")
	if tekton["pipelinesInstalled"] != false {
		t.Fatalf("expected pipelinesInstalled=false, got %#v", tekton["pipelinesInstalled"])
	}
	issues := arrayField(t, payload, "issues")
	if len(issues) == 0 {
		t.Fatalf("expected simulated backend to report at least one issue")
	}
}

func TestPreflightRejectsSimulatedBackendForRealTektonRuns(t *testing.T) {
	t.Parallel()

	router := NewRouter(NewHandler(backend.NewSimulatedBackend()))
	body := bytes.NewBufferString(`{"run":{"pipelineRunId":"run-preflight","pipelineName":"release","applicationId":"app","environment":"test","stages":["source","build","upload"]}}`)
	request := httptest.NewRequest(http.MethodPost, "/v1/preflight", body)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["ok"] != false {
		t.Fatalf("expected ok=false for simulated preflight, got %#v", payload["ok"])
	}
	checks := arrayField(t, payload, "checks")
	if len(checks) == 0 {
		t.Fatalf("expected failed checks for simulated preflight")
	}
	first, ok := checks[0].(map[string]any)
	if !ok {
		t.Fatalf("expected check object, got %#v", checks[0])
	}
	if first["status"] != "failed" {
		t.Fatalf("expected first check to fail, got %#v", first["status"])
	}
}

func TestRunTaskRunDetailAndLogsAreAddressable(t *testing.T) {
	t.Parallel()

	router := NewRouter(NewHandler(backend.NewSimulatedBackend()))
	createBody := bytes.NewBufferString(`{"pipelineRunId":"run-detail","pipelineName":"release","applicationId":"app","environment":"test","stages":["source"]}`)
	create := httptest.NewRequest(http.MethodPost, "/v1/runs", createBody)
	create.Header.Set("Content-Type", "application/json")
	createResponse := httptest.NewRecorder()
	router.ServeHTTP(createResponse, create)
	if createResponse.Code != http.StatusAccepted {
		t.Fatalf("expected create 202, got %d: %s", createResponse.Code, createResponse.Body.String())
	}

	detail := httptest.NewRequest(http.MethodGet, "/v1/runs/run-detail/taskruns/source-job", nil)
	detailResponse := httptest.NewRecorder()
	router.ServeHTTP(detailResponse, detail)
	if detailResponse.Code != http.StatusOK {
		t.Fatalf("expected detail 200, got %d: %s", detailResponse.Code, detailResponse.Body.String())
	}
	var detailPayload map[string]any
	if err := json.Unmarshal(detailResponse.Body.Bytes(), &detailPayload); err != nil {
		t.Fatalf("decode detail response: %v", err)
	}
	if detailPayload["taskRunName"] != "source-job" {
		t.Fatalf("expected source-job detail, got %#v", detailPayload["taskRunName"])
	}
	if detailPayload["pipelineTaskName"] != "source" {
		t.Fatalf("expected source pipeline task, got %#v", detailPayload["pipelineTaskName"])
	}

	logs := httptest.NewRequest(http.MethodGet, "/v1/runs/run-detail/taskruns/source-job/logs?step=clone", nil)
	logsResponse := httptest.NewRecorder()
	router.ServeHTTP(logsResponse, logs)
	if logsResponse.Code != http.StatusOK {
		t.Fatalf("expected logs 200, got %d: %s", logsResponse.Code, logsResponse.Body.String())
	}
	var logsPayload map[string]any
	if err := json.Unmarshal(logsResponse.Body.Bytes(), &logsPayload); err != nil {
		t.Fatalf("decode logs response: %v", err)
	}
	if logsPayload["taskRunName"] != "source-job" {
		t.Fatalf("expected logs for source-job, got %#v", logsPayload["taskRunName"])
	}
	lines := arrayField(t, logsPayload, "lines")
	if len(lines) == 0 {
		t.Fatalf("expected at least one log line")
	}
}

func objectField(t *testing.T, payload map[string]any, field string) map[string]any {
	t.Helper()
	value, ok := payload[field].(map[string]any)
	if !ok {
		t.Fatalf("expected object field %s, got %#v", field, payload[field])
	}
	return value
}

func arrayField(t *testing.T, payload map[string]any, field string) []any {
	t.Helper()
	value, ok := payload[field].([]any)
	if !ok {
		t.Fatalf("expected array field %s, got %#v", field, payload[field])
	}
	return value
}
