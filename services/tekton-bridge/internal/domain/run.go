// Package domain holds the JSON DTOs shared with the Nest API.
// Schema parity with packages/shared TypeScript types is maintained manually
// since this service does not import any TS code.
package domain

// JobStatus mirrors the Yunxiao status enum used by both Nest and the bridge.
type JobStatus string

const (
	StatusInit     JobStatus = "INIT"
	StatusQueued   JobStatus = "QUEUED"
	StatusRunning  JobStatus = "RUNNING"
	StatusSuccess  JobStatus = "SUCCESS"
	StatusFail     JobStatus = "FAIL"
	StatusSkipped  JobStatus = "SKIPPED"
	StatusCanceled JobStatus = "CANCELED"
)

// Backend identifies which executor produced a RunHandle.
type Backend string

const (
	BackendSimulated Backend = "simulated"
	BackendTekton    Backend = "tekton"
)

// PipelineSource is the Yunxiao-aligned source spec carried with the run.
type PipelineSource struct {
	ID         string `json:"id"`
	Type       string `json:"type"`
	Endpoint   string `json:"endpoint"`
	Branch     string `json:"branch,omitempty"`
	Tag        string `json:"tag,omitempty"`
	CloneDepth int    `json:"cloneDepth,omitempty"`
}

// GlobalParam is a single key/value pair attached to a run.
type GlobalParam struct {
	Key         string `json:"key"`
	Value       string `json:"value"`
	Encrypted   bool   `json:"encrypted,omitempty"`
	Description string `json:"description,omitempty"`
}

// StepInstance represents one container/command-level execution.
type StepInstance struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Image    string    `json:"image,omitempty"`
	Status   JobStatus `json:"status"`
	ExitCode *int      `json:"exitCode,omitempty"`
}

// JobInstance is one task execution inside a stage.
type JobInstance struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	TaskRef    string         `json:"taskRef"`
	Status     JobStatus      `json:"status"`
	StartedAt  string         `json:"startedAt,omitempty"`
	FinishedAt string         `json:"finishedAt,omitempty"`
	DurationMs int64          `json:"durationMs,omitempty"`
	Steps      []StepInstance `json:"steps"`
}

// StageInstance groups parallel jobs.
type StageInstance struct {
	Index  int           `json:"index"`
	Name   string        `json:"name"`
	Status JobStatus     `json:"status"`
	Jobs   []JobInstance `json:"jobs"`
}

// StartRunInput is the request body sent by Nest to POST /v1/runs.
type StartRunInput struct {
	PipelineRunID    string           `json:"pipelineRunId"`
	PipelineName     string           `json:"pipelineName"`
	ApplicationID    string           `json:"applicationId"`
	Environment      string           `json:"environment"`
	Stages           []string         `json:"stages"`
	Sources          []PipelineSource `json:"sources"`
	GlobalParams     []GlobalParam    `json:"globalParams"`
	CanaryPercent    int              `json:"canaryPercent"`
	RequiresApproval bool             `json:"requiresApproval"`
}

// RunHandle uniquely identifies a run inside the bridge.
type RunHandle struct {
	RunID   string  `json:"runId"`
	Backend Backend `json:"backend"`
}

// RunStatus is the response of GET /v1/runs/:id.
type RunStatus struct {
	RunID      string          `json:"runId"`
	Status     JobStatus       `json:"status"`
	Stages     []StageInstance `json:"stages"`
	StartedAt  string          `json:"startedAt,omitempty"`
	FinishedAt string          `json:"finishedAt,omitempty"`
}

// RunEvent is a single SSE payload emitted on /v1/runs/:id/events.
type RunEvent struct {
	RunID     string                 `json:"runId"`
	Type      string                 `json:"type"`
	Timestamp string                 `json:"timestamp"`
	Payload   map[string]interface{} `json:"payload"`
}
