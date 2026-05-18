package backend

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/company/deploy-management/services/tekton-bridge/internal/domain"
)

// stageDurations mirrors the Nest SimulatedExecutor timings.
var stageDurations = map[string]time.Duration{
	"source":   18 * time.Second,
	"test":     96 * time.Second,
	"build":    184 * time.Second,
	"package":  42 * time.Second,
	"upload":   28 * time.Second,
	"deploy":   76 * time.Second,
	"canary":   135 * time.Second,
	"approval": 0,
	"promote":  58 * time.Second,
}

type simulatedRecord struct {
	mu          sync.Mutex
	input       domain.StartRunInput
	stages      []domain.StageInstance
	startedAt   time.Time
	finishedAt  *time.Time
	canceled    bool
	subscribers []chan domain.RunEvent
}

// SimulatedBackend keeps run state in memory and advances stages on a timer
// goroutine. Useful for local development without a Kubernetes cluster.
type SimulatedBackend struct {
	mu      sync.RWMutex
	records map[string]*simulatedRecord
}

// NewSimulatedBackend constructs an empty in-memory backend.
func NewSimulatedBackend() *SimulatedBackend {
	return &SimulatedBackend{records: make(map[string]*simulatedRecord)}
}

// Name implements Backend.
func (s *SimulatedBackend) Name() domain.Backend { return domain.BackendSimulated }

// Capabilities implements Backend.
func (s *SimulatedBackend) Capabilities(_ context.Context) (domain.BridgeCapabilities, error) {
	return simulatedCapabilities(), nil
}

// Preflight implements Backend.
func (s *SimulatedBackend) Preflight(_ context.Context, request domain.PreflightRequest) (domain.PreflightReport, error) {
	capabilities := simulatedCapabilities()
	namespace := request.Namespace
	if namespace == "" {
		namespace = capabilities.Kubernetes.Namespace
	}
	checks := []domain.PreflightCheck{
		{
			Code:        "backend.real-tekton",
			Status:      "failed",
			Message:     "当前 bridge 使用 simulated backend，不能创建真实 Kubernetes PipelineRun",
			Remediation: "使用 go run -tags tekton ./cmd/server 启动 bridge，并保持 TEKTON_BRIDGE_BACKEND=tekton 或留空。",
		},
	}
	return domain.PreflightReport{
		OK:           false,
		Backend:      domain.BackendSimulated,
		Namespace:    namespace,
		Checks:       checks,
		Capabilities: capabilities,
	}, nil
}

// Start implements Backend.
func (s *SimulatedBackend) Start(ctx context.Context, input domain.StartRunInput) (domain.RunHandle, error) {
	if input.PipelineRunID == "" {
		return domain.RunHandle{}, errors.New("pipelineRunId is required")
	}
	stages := make([]domain.StageInstance, len(input.Stages))
	for i, name := range input.Stages {
		stages[i] = domain.StageInstance{
			Index:  i,
			Name:   name,
			Status: domain.StatusInit,
			Jobs: []domain.JobInstance{
				{
					ID:      fmt.Sprintf("%s-job", name),
					Name:    name,
					TaskRef: name,
					Status:  domain.StatusInit,
					Steps:   []domain.StepInstance{},
				},
			},
		}
	}
	record := &simulatedRecord{
		input:     input,
		stages:    stages,
		startedAt: time.Now().UTC(),
	}
	s.mu.Lock()
	s.records[input.PipelineRunID] = record
	s.mu.Unlock()

	go s.advance(input.PipelineRunID, record)
	return domain.RunHandle{RunID: input.PipelineRunID, Backend: domain.BackendSimulated}, nil
}

// Status implements Backend.
func (s *SimulatedBackend) Status(_ context.Context, handle domain.RunHandle) (domain.RunStatus, error) {
	record, err := s.requireRecord(handle.RunID)
	if err != nil {
		return domain.RunStatus{}, err
	}
	record.mu.Lock()
	defer record.mu.Unlock()
	status := s.derive(record)
	finished := ""
	if record.finishedAt != nil {
		finished = record.finishedAt.UTC().Format(time.RFC3339)
	}
	return domain.RunStatus{
		RunID:      handle.RunID,
		Status:     status,
		Stages:     copyStages(record.stages),
		StartedAt:  record.startedAt.UTC().Format(time.RFC3339),
		FinishedAt: finished,
	}, nil
}

// Cancel implements Backend.
func (s *SimulatedBackend) Cancel(_ context.Context, handle domain.RunHandle) error {
	record, err := s.requireRecord(handle.RunID)
	if err != nil {
		return err
	}
	record.mu.Lock()
	defer record.mu.Unlock()
	if record.canceled {
		return nil
	}
	record.canceled = true
	now := time.Now().UTC()
	record.finishedAt = &now
	for i := range record.stages {
		if record.stages[i].Status == domain.StatusInit ||
			record.stages[i].Status == domain.StatusQueued ||
			record.stages[i].Status == domain.StatusRunning {
			record.stages[i].Status = domain.StatusCanceled
			for j := range record.stages[i].Jobs {
				record.stages[i].Jobs[j].Status = domain.StatusCanceled
			}
		}
	}
	s.publish(record, domain.RunEvent{
		RunID:     handle.RunID,
		Type:      "status",
		Timestamp: now.Format(time.RFC3339),
		Payload:   map[string]interface{}{"status": string(domain.StatusCanceled)},
	})
	return nil
}

// Events implements Backend. Returns a buffered channel that the caller must
// fully drain or cancel via the context.
func (s *SimulatedBackend) Events(ctx context.Context, handle domain.RunHandle) (<-chan domain.RunEvent, error) {
	record, err := s.requireRecord(handle.RunID)
	if err != nil {
		return nil, err
	}
	out := make(chan domain.RunEvent, 16)
	record.mu.Lock()
	record.subscribers = append(record.subscribers, out)
	record.mu.Unlock()

	go func() {
		<-ctx.Done()
		record.mu.Lock()
		for i, ch := range record.subscribers {
			if ch == out {
				record.subscribers = append(record.subscribers[:i], record.subscribers[i+1:]...)
				close(out)
				break
			}
		}
		record.mu.Unlock()
	}()
	return out, nil
}

// TaskRunDetail implements Backend.
func (s *SimulatedBackend) TaskRunDetail(_ context.Context, handle domain.RunHandle, taskRunName string) (domain.TaskRunDetail, error) {
	record, err := s.requireRecord(handle.RunID)
	if err != nil {
		return domain.TaskRunDetail{}, err
	}
	record.mu.Lock()
	defer record.mu.Unlock()
	for _, stage := range record.stages {
		for _, job := range stage.Jobs {
			if job.ID != taskRunName {
				continue
			}
			return domain.TaskRunDetail{
				RunID:            handle.RunID,
				Namespace:        "simulated",
				TaskRunName:      job.ID,
				PipelineTaskName: stage.Name,
				PodName:          fmt.Sprintf("%s-pod", job.ID),
				Status:           job.Status,
				StartedAt:        job.StartedAt,
				FinishedAt:       job.FinishedAt,
				Steps:            append([]domain.StepInstance(nil), job.Steps...),
				Results:          copyStringMap(job.Result),
				Events: []domain.ObjectEvent{
					{
						Type:      "Normal",
						Reason:    "SimulatedTaskRun",
						Message:   fmt.Sprintf("Simulated TaskRun %s for stage %s", job.ID, stage.Name),
						Timestamp: record.startedAt.UTC().Format(time.RFC3339),
						InvolvedObject: domain.ObjectRef{
							APIVersion: "tekton.dev/v1",
							Kind:       "TaskRun",
							Namespace:  "simulated",
							Name:       job.ID,
						},
					},
				},
			}, nil
		}
	}
	return domain.TaskRunDetail{}, fmt.Errorf("TaskRun %s not found for run %s", taskRunName, handle.RunID)
}

// TaskRunLogs implements Backend.
func (s *SimulatedBackend) TaskRunLogs(ctx context.Context, handle domain.RunHandle, taskRunName string, stepName string) (domain.TaskRunLogs, error) {
	detail, err := s.TaskRunDetail(ctx, handle, taskRunName)
	if err != nil {
		return domain.TaskRunLogs{}, err
	}
	if stepName == "" {
		stepName = "main"
	}
	return domain.TaskRunLogs{
		RunID:       handle.RunID,
		Namespace:   detail.Namespace,
		TaskRunName: detail.TaskRunName,
		PodName:     detail.PodName,
		StepName:    stepName,
		Container:   fmt.Sprintf("step-%s", stepName),
		Source:      "simulated",
		Lines: []string{
			fmt.Sprintf("[simulated] run=%s taskRun=%s step=%s", handle.RunID, taskRunName, stepName),
			"真实日志需要 tekton backend 通过 Kubernetes pods/log 读取。",
		},
		Truncated: false,
	}, nil
}

func simulatedCapabilities() domain.BridgeCapabilities {
	return domain.BridgeCapabilities{
		Backend: domain.BackendSimulated,
		Status:  "disconnected",
		Kubernetes: domain.KubernetesCapabilities{
			Reachable: false,
			Namespace: "simulated",
		},
		Tekton: domain.TektonCapabilities{
			PipelinesInstalled: false,
			TriggersInstalled:  false,
			ResultsInstalled:   false,
			ChainsInstalled:    false,
			Resources:          []string{},
		},
		Runtime: domain.RuntimeCapabilities{
			SourcePVCConfigured:        false,
			DockerSecretConfigured:     false,
			ServiceAccountName:         "",
			BuildStrategy:              "simulated",
			PrivilegedSidecarRequired:  false,
			InlinePipelineSpecFallback: false,
		},
		Issues: []domain.BridgeIssue{
			{
				Severity:    "failed",
				Code:        "backend.simulated",
				Message:     "bridge 当前运行在 simulated backend，只能用于本地演示，不能代表真实 Kubernetes/Tekton 控制面。",
				Remediation: "正式流程请使用 tekton build tag 启动 bridge，并配置 kubeconfig、namespace、PVC、Secret 和 ServiceAccount。",
			},
		},
	}
}

func (s *SimulatedBackend) advance(runID string, record *simulatedRecord) {
	stages := record.input.Stages
	for index, name := range stages {
		duration := stageDurations[name]
		if duration == 0 {
			duration = 250 * time.Millisecond
		}
		// Compress for snappier dev: real timings are minutes; we use 1/100th.
		duration = duration / 100
		time.Sleep(duration)

		record.mu.Lock()
		if record.canceled {
			record.mu.Unlock()
			return
		}
		now := time.Now().UTC()
		nowStr := now.Format(time.RFC3339)
		if name == "approval" && record.input.RequiresApproval {
			record.stages[index].Status = domain.StatusQueued
			for j := range record.stages[index].Jobs {
				record.stages[index].Jobs[j].Status = domain.StatusQueued
			}
			s.publish(record, domain.RunEvent{
				RunID:     runID,
				Type:      "stage",
				Timestamp: nowStr,
				Payload: map[string]interface{}{
					"stage":  name,
					"status": string(domain.StatusQueued),
					"reason": "awaiting manual approval",
				},
			})
			record.mu.Unlock()
			return
		}
		record.stages[index].Status = domain.StatusSuccess
		for j := range record.stages[index].Jobs {
			record.stages[index].Jobs[j].Status = domain.StatusSuccess
			record.stages[index].Jobs[j].StartedAt = nowStr
			record.stages[index].Jobs[j].FinishedAt = nowStr
			record.stages[index].Jobs[j].DurationMs = duration.Milliseconds()
		}
		s.publish(record, domain.RunEvent{
			RunID:     runID,
			Type:      "stage",
			Timestamp: nowStr,
			Payload: map[string]interface{}{
				"stage":  name,
				"status": string(domain.StatusSuccess),
				"index":  index,
			},
		})
		record.mu.Unlock()
	}

	record.mu.Lock()
	now := time.Now().UTC()
	record.finishedAt = &now
	s.publish(record, domain.RunEvent{
		RunID:     runID,
		Type:      "status",
		Timestamp: now.Format(time.RFC3339),
		Payload:   map[string]interface{}{"status": string(domain.StatusSuccess)},
	})
	record.mu.Unlock()
}

// publish must be called with record.mu held.
func (s *SimulatedBackend) publish(record *simulatedRecord, event domain.RunEvent) {
	for _, sub := range record.subscribers {
		select {
		case sub <- event:
		default:
			// Drop event if subscriber is too slow; SSE is best-effort.
		}
	}
}

func (s *SimulatedBackend) requireRecord(runID string) (*simulatedRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	record, ok := s.records[runID]
	if !ok {
		return nil, fmt.Errorf("run %s not found", runID)
	}
	return record, nil
}

func (s *SimulatedBackend) derive(record *simulatedRecord) domain.JobStatus {
	if record.canceled {
		return domain.StatusCanceled
	}
	allDone := true
	anyFail := false
	anyRun := false
	for _, stage := range record.stages {
		switch stage.Status {
		case domain.StatusFail:
			anyFail = true
		case domain.StatusRunning:
			anyRun = true
			allDone = false
		case domain.StatusInit, domain.StatusQueued:
			allDone = false
		}
	}
	if anyFail {
		return domain.StatusFail
	}
	if allDone {
		return domain.StatusSuccess
	}
	if anyRun {
		return domain.StatusRunning
	}
	return domain.StatusQueued
}

func copyStages(in []domain.StageInstance) []domain.StageInstance {
	out := make([]domain.StageInstance, len(in))
	for i, stage := range in {
		jobs := make([]domain.JobInstance, len(stage.Jobs))
		for j, job := range stage.Jobs {
			steps := make([]domain.StepInstance, len(job.Steps))
			copy(steps, job.Steps)
			job.Steps = steps
			jobs[j] = job
		}
		stage.Jobs = jobs
		out[i] = stage
	}
	return out
}

func copyStringMap(in map[string]string) map[string]string {
	if len(in) == 0 {
		return map[string]string{}
	}
	out := make(map[string]string, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}
