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
	mu         sync.Mutex
	input      domain.StartRunInput
	stages     []domain.StageInstance
	startedAt  time.Time
	finishedAt *time.Time
	canceled   bool
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
