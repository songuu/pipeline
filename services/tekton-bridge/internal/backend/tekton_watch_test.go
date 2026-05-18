//go:build tekton

package backend

import (
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/watch"
)

func TestRunEventFromWatchedTaskRunCarriesObjectIdentity(t *testing.T) {
	t.Parallel()

	taskRun := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "tekton.dev/v1",
		"kind":       "TaskRun",
		"metadata": map[string]interface{}{
			"name":              "run-a-build",
			"namespace":         "apps-test",
			"resourceVersion":   "42",
			"creationTimestamp": "2026-05-14T03:25:00Z",
			"labels": map[string]interface{}{
				"tekton.dev/pipelineRun":  "run-a",
				"tekton.dev/pipelineTask": "build",
			},
		},
		"status": map[string]interface{}{
			"conditions": []interface{}{
				map[string]interface{}{"type": "Succeeded", "status": "Unknown"},
			},
		},
	}}

	event, ok := runEventFromWatchedObject("run-a", "taskrun", watch.Modified, taskRun)
	if !ok {
		t.Fatalf("expected taskrun watch event to be converted")
	}
	if event.Type != "taskrun" {
		t.Fatalf("expected taskrun event type, got %s", event.Type)
	}
	if event.Payload["name"] != "run-a-build" {
		t.Fatalf("expected object name in payload, got %#v", event.Payload["name"])
	}
	if event.Payload["pipelineTaskName"] != "build" {
		t.Fatalf("expected pipeline task name in payload, got %#v", event.Payload["pipelineTaskName"])
	}
	if event.Payload["resourceVersion"] != "42" {
		t.Fatalf("expected resource version in payload, got %#v", event.Payload["resourceVersion"])
	}
	if event.Payload["status"] != "RUNNING" {
		t.Fatalf("expected mapped running status, got %#v", event.Payload["status"])
	}
}
