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
	Key             string   `json:"key"`
	Value           string   `json:"value"`
	Encrypted       bool     `json:"encrypted,omitempty"`
	Description     string   `json:"description,omitempty"`
	InjectionTiming string   `json:"injectionTiming,omitempty"`
	TargetStages    []string `json:"targetStages,omitempty"`
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
	ID         string            `json:"id"`
	Name       string            `json:"name"`
	TaskRef    string            `json:"taskRef"`
	Status     JobStatus         `json:"status"`
	StartedAt  string            `json:"startedAt,omitempty"`
	FinishedAt string            `json:"finishedAt,omitempty"`
	DurationMs int64             `json:"durationMs,omitempty"`
	Steps      []StepInstance    `json:"steps"`
	Result     map[string]string `json:"result,omitempty"`
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

// TaskRunDetail is the drill-down view for one Tekton TaskRun.
type TaskRunDetail struct {
	RunID            string            `json:"runId"`
	Namespace        string            `json:"namespace"`
	TaskRunName      string            `json:"taskRunName"`
	PipelineTaskName string            `json:"pipelineTaskName"`
	PodName          string            `json:"podName,omitempty"`
	Status           JobStatus         `json:"status"`
	StartedAt        string            `json:"startedAt,omitempty"`
	FinishedAt       string            `json:"finishedAt,omitempty"`
	Steps            []StepInstance    `json:"steps"`
	Results          map[string]string `json:"results"`
	Events           []ObjectEvent     `json:"events"`
}

// ObjectEvent is a normalized Kubernetes event associated with a run object.
type ObjectEvent struct {
	Type           string    `json:"type"`
	Reason         string    `json:"reason"`
	Message        string    `json:"message"`
	Timestamp      string    `json:"timestamp"`
	InvolvedObject ObjectRef `json:"involvedObject"`
}

// ObjectRef identifies the Kubernetes object involved in an event.
type ObjectRef struct {
	APIVersion string `json:"apiVersion,omitempty"`
	Kind       string `json:"kind"`
	Namespace  string `json:"namespace,omitempty"`
	Name       string `json:"name"`
	UID        string `json:"uid,omitempty"`
}

// TaskRunLogs contains Kubernetes Pod logs for a TaskRun step container.
type TaskRunLogs struct {
	RunID       string   `json:"runId"`
	Namespace   string   `json:"namespace"`
	TaskRunName string   `json:"taskRunName"`
	PodName     string   `json:"podName,omitempty"`
	StepName    string   `json:"stepName,omitempty"`
	Container   string   `json:"container,omitempty"`
	Source      string   `json:"source"`
	Lines       []string `json:"lines"`
	Truncated   bool     `json:"truncated"`
}

// BridgeIssue is a structured problem surfaced by capability discovery.
type BridgeIssue struct {
	Severity    string `json:"severity"`
	Code        string `json:"code"`
	Message     string `json:"message"`
	Remediation string `json:"remediation,omitempty"`
}

// KubernetesCapabilities describes the concrete cluster context visible to the bridge.
type KubernetesCapabilities struct {
	Reachable     bool   `json:"reachable"`
	Namespace     string `json:"namespace"`
	ServerVersion string `json:"serverVersion,omitempty"`
	Error         string `json:"error,omitempty"`
}

// TektonCapabilities reports which Tekton API groups/resources the bridge can observe.
type TektonCapabilities struct {
	PipelinesInstalled bool     `json:"pipelinesInstalled"`
	TriggersInstalled  bool     `json:"triggersInstalled"`
	ResultsInstalled   bool     `json:"resultsInstalled"`
	ChainsInstalled    bool     `json:"chainsInstalled"`
	Resources          []string `json:"resources"`
}

// RuntimeCapabilities summarizes the runtime wiring required by inline builds.
type RuntimeCapabilities struct {
	SourcePVCConfigured        bool   `json:"sourcePvcConfigured"`
	DockerSecretConfigured     bool   `json:"dockerSecretConfigured"`
	ServiceAccountName         string `json:"serviceAccountName"`
	BuildStrategy              string `json:"buildStrategy"`
	PrivilegedSidecarRequired  bool   `json:"privilegedSidecarRequired"`
	ClusterPipelineRef         string `json:"clusterPipelineRef,omitempty"`
	InlinePipelineSpecFallback bool   `json:"inlinePipelineSpecFallback"`
}

// BridgeCapabilities is the response body of GET /v1/capabilities.
type BridgeCapabilities struct {
	Backend    Backend                `json:"backend"`
	Status     string                 `json:"status"`
	Kubernetes KubernetesCapabilities `json:"kubernetes"`
	Tekton     TektonCapabilities     `json:"tekton"`
	Runtime    RuntimeCapabilities    `json:"runtime"`
	Issues     []BridgeIssue          `json:"issues"`
}

// PreflightRequest asks the bridge to validate a potential run before creating a PipelineRun.
type PreflightRequest struct {
	Namespace          string         `json:"namespace,omitempty"`
	ServiceAccountName string         `json:"serviceAccountName,omitempty"`
	SourcePVC          string         `json:"sourcePvc,omitempty"`
	DockerSecret       string         `json:"dockerSecret,omitempty"`
	BuildStrategy      string         `json:"buildStrategy,omitempty"`
	Run                *StartRunInput `json:"run,omitempty"`
}

// PreflightCheck captures one validation item.
type PreflightCheck struct {
	Code        string `json:"code"`
	Status      string `json:"status"`
	Message     string `json:"message"`
	Remediation string `json:"remediation,omitempty"`
}

// PreflightReport is the response body of POST /v1/preflight.
type PreflightReport struct {
	OK           bool               `json:"ok"`
	Backend      Backend            `json:"backend"`
	Namespace    string             `json:"namespace"`
	Checks       []PreflightCheck   `json:"checks"`
	Capabilities BridgeCapabilities `json:"capabilities"`
}
