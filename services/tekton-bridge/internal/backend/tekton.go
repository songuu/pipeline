//go:build tekton

// Package backend's TektonBackend bridges to a Kubernetes cluster running
// tektoncd/pipeline. Build with `go build -tags tekton ./...` to enable.
package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/company/deploy-management/services/tekton-bridge/internal/domain"
)

var (
	persistentVolumeClaimResource = schema.GroupVersionResource{Group: "", Version: "v1", Resource: "persistentvolumeclaims"}
	namespaceResource             = schema.GroupVersionResource{Group: "", Version: "v1", Resource: "namespaces"}
	secretResource                = schema.GroupVersionResource{Group: "", Version: "v1", Resource: "secrets"}
	serviceAccountResource        = schema.GroupVersionResource{Group: "", Version: "v1", Resource: "serviceaccounts"}
	podResource                   = schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}
	eventResource                 = schema.GroupVersionResource{Group: "", Version: "v1", Resource: "events"}
	pipelineRunResource           = schema.GroupVersionResource{Group: "tekton.dev", Version: "v1", Resource: "pipelineruns"}
	taskRunResource               = schema.GroupVersionResource{Group: "tekton.dev", Version: "v1", Resource: "taskruns"}
)

type tektonRecord struct {
	input           domain.StartRunInput
	namespace       string
	pipelineRunName string
	startedAt       time.Time
}

// TektonBackend creates real Tekton PipelineRun objects and observes the
// TaskRun objects that Tekton's controller creates from them.
type TektonBackend struct {
	Namespace string

	client    dynamic.Interface
	core      kubernetes.Interface
	discovery discovery.DiscoveryInterface

	mu      sync.RWMutex
	records map[string]tektonRecord

	pipelineRef string
	stageImage  string
	stageSleep  string
	nodeImage   string
	dockerCli   string
	dockerDind  string
}

// NewTektonBackend constructs a TektonBackend. It first tries in-cluster
// service account credentials, then TEKTON_BRIDGE_KUBECONFIG, KUBECONFIG, and
// finally ~/.kube/config.
func NewTektonBackend(namespace string) (*TektonBackend, error) {
	if namespace == "" {
		namespace = "default"
	}
	config, err := loadKubernetesConfig()
	if err != nil {
		return nil, err
	}
	client, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("create dynamic client: %w", err)
	}
	core, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("create kubernetes client: %w", err)
	}
	discoveryClient, err := discovery.NewDiscoveryClientForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("create discovery client: %w", err)
	}
	return &TektonBackend{
		Namespace:   namespace,
		client:      client,
		core:        core,
		discovery:   discoveryClient,
		records:     make(map[string]tektonRecord),
		pipelineRef: os.Getenv("TEKTON_PIPELINE_REF"),
		stageImage:  envOr("TEKTON_TASK_IMAGE", "alpine:3.20"),
		stageSleep:  envOr("TEKTON_STAGE_SLEEP_SECONDS", "2"),
		nodeImage:   envOr("TEKTON_NODE_BUILD_IMAGE", "node:20-alpine"),
		dockerCli:   envOr("TEKTON_DOCKER_CLI_IMAGE", "docker:27-cli"),
		dockerDind:  envOr("TEKTON_DOCKER_DIND_IMAGE", "docker:27-dind"),
	}, nil
}

func (t *TektonBackend) Name() domain.Backend { return domain.BackendTekton }

func (t *TektonBackend) Capabilities(ctx context.Context) (domain.BridgeCapabilities, error) {
	capabilities := t.baseCapabilities()
	serverVersion, err := t.discovery.ServerVersion()
	if err != nil {
		capabilities.Status = "failed"
		capabilities.Kubernetes.Error = err.Error()
		capabilities.Issues = append(capabilities.Issues, domain.BridgeIssue{
			Severity:    "failed",
			Code:        "kubernetes.unreachable",
			Message:     fmt.Sprintf("无法访问 Kubernetes API: %v", err),
			Remediation: "检查 TEKTON_BRIDGE_KUBECONFIG、KUBECONFIG 或集群内 ServiceAccount 配置。",
		})
		return capabilities, nil
	}
	capabilities.Kubernetes.Reachable = true
	capabilities.Kubernetes.ServerVersion = serverVersion.String()

	tektonResources, err := t.discovery.ServerResourcesForGroupVersion("tekton.dev/v1")
	if err != nil {
		capabilities.Issues = append(capabilities.Issues, domain.BridgeIssue{
			Severity:    "failed",
			Code:        "tekton.crd-missing",
			Message:     fmt.Sprintf("无法发现 tekton.dev/v1 资源: %v", err),
			Remediation: "安装 Tekton Pipelines，并确认 bridge 账号可以 discovery tekton.dev/v1。",
		})
	} else {
		resourceNames := apiResourceNames(tektonResources.APIResources)
		capabilities.Tekton.Resources = resourceNames
		capabilities.Tekton.PipelinesInstalled = hasAll(resourceNames, "pipelineruns", "taskruns")
	}

	groups, err := t.discovery.ServerGroups()
	if err == nil {
		capabilities.Tekton.TriggersInstalled = hasAPIGroup(groups.Groups, "triggers.tekton.dev")
		capabilities.Tekton.ResultsInstalled = hasAPIGroup(groups.Groups, "results.tekton.dev")
		capabilities.Tekton.ChainsInstalled = hasAPIGroup(groups.Groups, "chains.tekton.dev") || hasAPIGroup(groups.Groups, "operator.tekton.dev")
	}

	if !capabilities.Tekton.PipelinesInstalled {
		capabilities.Issues = append(capabilities.Issues, domain.BridgeIssue{
			Severity:    "failed",
			Code:        "tekton.pipelines-missing",
			Message:     "当前集群未发现 pipelineruns/taskruns，无法执行真实 Tekton PipelineRun。",
			Remediation: "安装 Tekton Pipelines，或切换 EXECUTOR=local-docker 做本机真实构建。",
		})
	}

	if _, err := t.client.Resource(namespaceResource).Get(ctx, t.Namespace, metav1.GetOptions{}); err != nil {
		capabilities.Issues = append(capabilities.Issues, domain.BridgeIssue{
			Severity:    "failed",
			Code:        "namespace.missing",
			Message:     fmt.Sprintf("无法访问 namespace %s: %v", t.Namespace, err),
			Remediation: fmt.Sprintf("创建 namespace %s，或为 bridge ServiceAccount 授权 get/list/watch。", t.Namespace),
		})
	}

	capabilities.Status = capabilityStatus(capabilities.Issues)
	return capabilities, nil
}

func (t *TektonBackend) Preflight(ctx context.Context, request domain.PreflightRequest) (domain.PreflightReport, error) {
	capabilities, err := t.Capabilities(ctx)
	if err != nil {
		return domain.PreflightReport{}, err
	}
	namespace := firstNonEmpty(request.Namespace, t.Namespace)
	checks := []domain.PreflightCheck{}
	addCheck := func(code string, status string, message string, remediation string) {
		checks = append(checks, domain.PreflightCheck{
			Code:        code,
			Status:      status,
			Message:     message,
			Remediation: remediation,
		})
	}

	addCheck("backend.real-tekton", "passed", "bridge 当前使用 tekton backend，可创建真实 PipelineRun。", "")
	if capabilities.Kubernetes.Reachable {
		addCheck("kubernetes.reachable", "passed", fmt.Sprintf("Kubernetes API 可访问: %s", capabilities.Kubernetes.ServerVersion), "")
	} else {
		addCheck("kubernetes.reachable", "failed", "Kubernetes API 不可访问。", "检查 kubeconfig、网络和 ServiceAccount。")
	}
	if capabilities.Tekton.PipelinesInstalled {
		addCheck("tekton.pipelines", "passed", "已发现 Tekton Pipelines CRD: pipelineruns/taskruns。", "")
	} else {
		addCheck("tekton.pipelines", "failed", "未发现 Tekton Pipelines CRD。", "安装 Tekton Pipelines 后重试。")
	}

	t.checkNamespacedResource(ctx, namespaceResource, "", namespace, "namespace.exists", "Namespace", &checks)
	serviceAccount := firstNonEmpty(request.ServiceAccountName, os.Getenv("TEKTON_SERVICE_ACCOUNT"))
	if serviceAccount != "" {
		t.checkNamespacedResource(ctx, serviceAccountResource, namespace, serviceAccount, "service-account.exists", "ServiceAccount", &checks)
	} else {
		addCheck("service-account.configured", "warning", "未配置 TEKTON_SERVICE_ACCOUNT，PipelineRun 将使用 namespace 默认 ServiceAccount。", "生产环境建议配置最小权限 ServiceAccount。")
	}

	run := request.Run
	if run != nil {
		if requiresSourceWorkspace(*run) {
			sourcePVC := firstNonEmpty(request.SourcePVC, os.Getenv("TEKTON_SOURCE_PVC"))
			if sourcePVC == "" {
				addCheck("workspace.source-pvc", "failed", "真实 checkout/build/upload 需要 source-ws PVC，但未配置。", "设置 TEKTON_SOURCE_PVC 或 runtime profile source workspace。")
			} else {
				t.checkNamespacedResource(ctx, persistentVolumeClaimResource, namespace, sourcePVC, "workspace.source-pvc", "PersistentVolumeClaim", &checks)
			}
		}
		if stages(*run)["upload"] {
			secret := firstNonEmpty(request.DockerSecret, dockerSecretName(*run))
			if secret == "" {
				addCheck("registry.docker-secret", "failed", "upload 阶段需要 docker-registry Secret，但未配置。", "创建 kubernetes.io/dockerconfigjson Secret，并在 REGISTRY_DOCKER_SECRET 或 TEKTON_DOCKER_SECRET 中引用。")
			} else if err := t.requireDockerConfigSecretInNamespace(ctx, *run, secret, namespace); err != nil {
				addCheck("registry.docker-secret", "failed", err.Error(), t.dockerSecretCreateCommandInNamespace(*run, secret, namespace))
			} else {
				addCheck("registry.docker-secret", "passed", fmt.Sprintf("docker-registry Secret %s/%s 可用。", namespace, secret), "")
			}
		}
		for _, requiredParam := range requiredBuildParams(*run) {
			if globalParamValue(*run, requiredParam) == "" {
				addCheck("param."+strings.ToLower(requiredParam), "failed", fmt.Sprintf("缺少运行参数 %s。", requiredParam), "检查流水线 buildConfig/imageArtifact 配置。")
			} else {
				addCheck("param."+strings.ToLower(requiredParam), "passed", fmt.Sprintf("运行参数 %s 已配置。", requiredParam), "")
			}
		}
	}

	return domain.PreflightReport{
		OK:           checksOK(checks),
		Backend:      domain.BackendTekton,
		Namespace:    namespace,
		Checks:       checks,
		Capabilities: capabilities,
	}, nil
}

func (t *TektonBackend) Start(ctx context.Context, input domain.StartRunInput) (domain.RunHandle, error) {
	if input.PipelineRunID == "" {
		return domain.RunHandle{}, fmt.Errorf("pipelineRunId is required")
	}
	if len(input.Stages) == 0 {
		return domain.RunHandle{}, fmt.Errorf("at least one stage is required")
	}
	if err := t.validatePrerequisites(ctx, input); err != nil {
		return domain.RunHandle{}, err
	}

	name := t.pipelineRunName(input)
	obj := t.pipelineRunObject(name, input)
	created, err := t.client.Resource(pipelineRunResource).Namespace(t.Namespace).Create(ctx, obj, metav1.CreateOptions{})
	if apierrors.IsAlreadyExists(err) {
		name = truncateDNSLabel(fmt.Sprintf("%s-%d", name, time.Now().Unix()))
		obj = t.pipelineRunObject(name, input)
		created, err = t.client.Resource(pipelineRunResource).Namespace(t.Namespace).Create(ctx, obj, metav1.CreateOptions{})
	}
	if err != nil {
		return domain.RunHandle{}, fmt.Errorf("create PipelineRun %s/%s: %w", t.Namespace, name, err)
	}

	record := tektonRecord{
		input:           input,
		namespace:       t.Namespace,
		pipelineRunName: created.GetName(),
		startedAt:       time.Now().UTC(),
	}
	t.mu.Lock()
	t.records[created.GetName()] = record
	t.mu.Unlock()

	return domain.RunHandle{RunID: created.GetName(), Backend: domain.BackendTekton}, nil
}

func (t *TektonBackend) validatePrerequisites(ctx context.Context, input domain.StartRunInput) error {
	stageSet := stages(input)
	if t.pipelineRef == "" && (stageSet["build"] || stageSet["upload"]) && !stageSet["source"] {
		return fmt.Errorf("missing source stage: inline real build/upload must checkout code before packaging or pushing")
	}
	requiresSourceWorkspace := t.pipelineRef == "" && (stageSet["source"] || stageSet["build"] || stageSet["upload"])
	if requiresSourceWorkspace {
		pvc := os.Getenv("TEKTON_SOURCE_PVC")
		if pvc == "" {
			return fmt.Errorf("missing TEKTON_SOURCE_PVC: inline real checkout/build/upload needs a source-ws PersistentVolumeClaim")
		}
		if err := t.requireNamespacedResource(ctx, persistentVolumeClaimResource, pvc, "PersistentVolumeClaim"); err != nil {
			return err
		}
	}

	if stageSet["build"] || stageSet["upload"] {
		if value := globalParamValue(input, "BUILD_CONTEXT"); value == "" {
			return fmt.Errorf("missing BUILD_CONTEXT: real package build needs a repository-relative build context")
		}
		if value := globalParamValue(input, "PACKAGE_BUILD_SCRIPT"); value == "" {
			return fmt.Errorf("missing PACKAGE_BUILD_SCRIPT: real package build needs a package.json script name, for example build or build:prod")
		}
		if value := globalParamValue(input, "PACKAGE_OUTPUT_PATHS"); value == "" {
			return fmt.Errorf("missing PACKAGE_OUTPUT_PATHS: real package build needs at least one output path, for example .next or dist")
		}
	}

	if stageSet["upload"] {
		if value := globalParamValue(input, "IMAGE_REF"); value == "" {
			return fmt.Errorf("missing IMAGE_REF: real image upload needs a full registry/repository:tag reference")
		}
		if value := globalParamValue(input, "DOCKERFILE_PATH"); value == "" {
			return fmt.Errorf("missing DOCKERFILE_PATH: real image upload needs a repository-relative Dockerfile path")
		}
		if secret := dockerSecretName(input); secret != "" {
			if err := t.requireDockerConfigSecret(ctx, input, secret); err != nil {
				return err
			}
		}
	}

	return nil
}

func (t *TektonBackend) requireDockerConfigSecret(ctx context.Context, input domain.StartRunInput, name string) error {
	return t.requireDockerConfigSecretInNamespace(ctx, input, name, t.Namespace)
}

func (t *TektonBackend) requireDockerConfigSecretInNamespace(ctx context.Context, input domain.StartRunInput, name string, namespace string) error {
	secret, err := t.client.Resource(secretResource).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf(
			"docker-registry Secret %s/%s is required for real image upload: %w. %s",
			namespace,
			name,
			err,
			t.dockerSecretCreateCommandInNamespace(input, name, namespace),
		)
	}

	secretType, _, _ := unstructured.NestedString(secret.Object, "type")
	data, _, _ := unstructured.NestedStringMap(secret.Object, "data")
	hasDockerConfig := data[".dockerconfigjson"] != "" || data[".dockercfg"] != ""
	if secretType != "kubernetes.io/dockerconfigjson" && secretType != "kubernetes.io/dockercfg" {
		return fmt.Errorf(
			"Secret %s/%s must be a docker-registry Secret, got type %q. %s",
			namespace,
			name,
			secretType,
			t.dockerSecretCreateCommandInNamespace(input, name, namespace),
		)
	}
	if !hasDockerConfig {
		return fmt.Errorf(
			"Secret %s/%s is missing .dockerconfigjson or .dockercfg data. %s",
			namespace,
			name,
			t.dockerSecretCreateCommandInNamespace(input, name, namespace),
		)
	}
	return nil
}

func (t *TektonBackend) dockerSecretCreateCommand(input domain.StartRunInput, secretName string) string {
	return t.dockerSecretCreateCommandInNamespace(input, secretName, t.Namespace)
}

func (t *TektonBackend) dockerSecretCreateCommandInNamespace(input domain.StartRunInput, secretName string, namespace string) string {
	registry := firstNonEmpty(globalParamValue(input, "IMAGE_REGISTRY"), registryFromImageRef(globalParamValue(input, "IMAGE_REF")), "<registry-host>")
	username := firstNonEmpty(globalParamValue(input, "REGISTRY_USERNAME"), "<registry-username>")
	return fmt.Sprintf(
		"Create it with: kubectl -n %s create secret docker-registry %s --docker-server=%s --docker-username=%s --docker-password=<registry-password>",
		namespace,
		secretName,
		registry,
		username,
	)
}

func (t *TektonBackend) requireNamespacedResource(
	ctx context.Context,
	resource schema.GroupVersionResource,
	name string,
	kind string,
) error {
	if _, err := t.client.Resource(resource).Namespace(t.Namespace).Get(ctx, name, metav1.GetOptions{}); err != nil {
		return fmt.Errorf("%s %s/%s is required for real Tekton execution: %w", kind, t.Namespace, name, err)
	}
	return nil
}

func (t *TektonBackend) checkNamespacedResource(
	ctx context.Context,
	resource schema.GroupVersionResource,
	namespace string,
	name string,
	code string,
	kind string,
	checks *[]domain.PreflightCheck,
) {
	var err error
	if namespace == "" {
		_, err = t.client.Resource(resource).Get(ctx, name, metav1.GetOptions{})
	} else {
		_, err = t.client.Resource(resource).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	}
	if err != nil {
		*checks = append(*checks, domain.PreflightCheck{
			Code:        code,
			Status:      "failed",
			Message:     fmt.Sprintf("%s %s/%s 不可访问: %v", kind, firstNonEmpty(namespace, "_cluster"), name, err),
			Remediation: fmt.Sprintf("创建 %s 或给 bridge ServiceAccount 授权 get/list/watch。", kind),
		})
		return
	}
	*checks = append(*checks, domain.PreflightCheck{
		Code:    code,
		Status:  "passed",
		Message: fmt.Sprintf("%s %s/%s 可访问。", kind, firstNonEmpty(namespace, "_cluster"), name),
	})
}

func (t *TektonBackend) baseCapabilities() domain.BridgeCapabilities {
	buildStrategy := envOr("TEKTON_BUILD_STRATEGY", "dind")
	return domain.BridgeCapabilities{
		Backend: domain.BackendTekton,
		Status:  "unknown",
		Kubernetes: domain.KubernetesCapabilities{
			Reachable: false,
			Namespace: t.Namespace,
		},
		Tekton: domain.TektonCapabilities{
			PipelinesInstalled: false,
			TriggersInstalled:  false,
			ResultsInstalled:   false,
			ChainsInstalled:    false,
			Resources:          []string{},
		},
		Runtime: domain.RuntimeCapabilities{
			SourcePVCConfigured:        os.Getenv("TEKTON_SOURCE_PVC") != "",
			DockerSecretConfigured:     os.Getenv("TEKTON_DOCKER_SECRET") != "",
			ServiceAccountName:         os.Getenv("TEKTON_SERVICE_ACCOUNT"),
			BuildStrategy:              buildStrategy,
			PrivilegedSidecarRequired:  buildStrategy == "dind",
			ClusterPipelineRef:         t.pipelineRef,
			InlinePipelineSpecFallback: t.pipelineRef == "",
		},
		Issues: []domain.BridgeIssue{},
	}
}

func apiResourceNames(resources []metav1.APIResource) []string {
	out := make([]string, 0, len(resources))
	for _, resource := range resources {
		if resource.Name != "" {
			out = append(out, resource.Name)
		}
	}
	sort.Strings(out)
	return out
}

func hasAll(resources []string, names ...string) bool {
	seen := map[string]bool{}
	for _, resource := range resources {
		seen[resource] = true
	}
	for _, name := range names {
		if !seen[name] {
			return false
		}
	}
	return true
}

func hasAPIGroup(groups []metav1.APIGroup, name string) bool {
	for _, group := range groups {
		if group.Name == name {
			return true
		}
	}
	return false
}

func capabilityStatus(issues []domain.BridgeIssue) string {
	status := "ready"
	for _, issue := range issues {
		if issue.Severity == "failed" {
			return "failed"
		}
		if issue.Severity == "warning" {
			status = "degraded"
		}
	}
	return status
}

func requiresSourceWorkspace(input domain.StartRunInput) bool {
	stageSet := stages(input)
	return stageSet["source"] || stageSet["build"] || stageSet["upload"]
}

func requiredBuildParams(input domain.StartRunInput) []string {
	stageSet := stages(input)
	required := []string{}
	if stageSet["build"] || stageSet["upload"] {
		required = append(required, "BUILD_CONTEXT", "PACKAGE_BUILD_SCRIPT", "PACKAGE_OUTPUT_PATHS")
	}
	if stageSet["upload"] {
		required = append(required, "IMAGE_REF", "DOCKERFILE_PATH")
	}
	return required
}

func checksOK(checks []domain.PreflightCheck) bool {
	for _, check := range checks {
		if check.Status == "failed" {
			return false
		}
	}
	return true
}

func (t *TektonBackend) Status(ctx context.Context, handle domain.RunHandle) (domain.RunStatus, error) {
	record, err := t.record(ctx, handle.RunID)
	if err != nil {
		return domain.RunStatus{}, err
	}
	pr, err := t.client.Resource(pipelineRunResource).Namespace(record.namespace).Get(ctx, record.pipelineRunName, metav1.GetOptions{})
	if err != nil {
		return domain.RunStatus{}, fmt.Errorf("get PipelineRun %s/%s: %w", record.namespace, record.pipelineRunName, err)
	}
	taskRuns, err := t.listTaskRuns(ctx, record.namespace, record.pipelineRunName)
	if err != nil {
		return domain.RunStatus{}, err
	}
	stages := t.stageInstances(record.input, taskRuns)
	status := conditionStatus(pr, domain.StatusRunning)
	startedAt, finishedAt := pipelineTimes(pr, record.startedAt)
	return domain.RunStatus{
		RunID:      handle.RunID,
		Status:     status,
		Stages:     stages,
		StartedAt:  startedAt,
		FinishedAt: finishedAt,
	}, nil
}

func (t *TektonBackend) Cancel(ctx context.Context, handle domain.RunHandle) error {
	record, err := t.record(ctx, handle.RunID)
	if err != nil {
		return err
	}
	patch := []byte(`{"spec":{"status":"PipelineRunCancelled"}}`)
	_, err = t.client.Resource(pipelineRunResource).Namespace(record.namespace).Patch(
		ctx,
		record.pipelineRunName,
		types.MergePatchType,
		patch,
		metav1.PatchOptions{},
	)
	if err != nil {
		return fmt.Errorf("cancel PipelineRun %s/%s: %w", record.namespace, record.pipelineRunName, err)
	}
	return nil
}

func (t *TektonBackend) Events(ctx context.Context, handle domain.RunHandle) (<-chan domain.RunEvent, error) {
	record, err := t.record(ctx, handle.RunID)
	if err != nil {
		return nil, err
	}
	status, err := t.Status(ctx, handle)
	if err != nil {
		return nil, err
	}
	out := make(chan domain.RunEvent, 16)
	go func() {
		defer close(out)
		t.emitStatusSnapshot(ctx, out, handle.RunID, status)
		if isTerminal(status.Status) {
			return
		}

		t.watchRunResource(ctx, out, handle.RunID, "pipelinerun", pipelineRunResource, record.namespace, metav1.ListOptions{
			FieldSelector: fmt.Sprintf("metadata.name=%s", record.pipelineRunName),
		})
		t.watchRunResource(ctx, out, handle.RunID, "taskrun", taskRunResource, record.namespace, metav1.ListOptions{
			LabelSelector: fmt.Sprintf("tekton.dev/pipelineRun=%s", record.pipelineRunName),
		})
		t.watchRunResource(ctx, out, handle.RunID, "pod", podResource, record.namespace, metav1.ListOptions{
			LabelSelector: fmt.Sprintf("tekton.dev/pipelineRun=%s", record.pipelineRunName),
		})
		t.watchRunResource(ctx, out, handle.RunID, "kubernetes-event", eventResource, record.namespace, metav1.ListOptions{
			FieldSelector: fmt.Sprintf("involvedObject.name=%s", record.pipelineRunName),
		})
		<-ctx.Done()
	}()
	return out, nil
}

func (t *TektonBackend) emitStatusSnapshot(ctx context.Context, out chan<- domain.RunEvent, runID string, status domain.RunStatus) {
	now := time.Now().UTC().Format(time.RFC3339)
	sendEvent(ctx, out, domain.RunEvent{
		RunID:     runID,
		Type:      "status",
		Timestamp: now,
		Payload:   map[string]interface{}{"status": string(status.Status), "source": "snapshot"},
	})
	for _, stage := range status.Stages {
		sendEvent(ctx, out, domain.RunEvent{
			RunID:     runID,
			Type:      "stage",
			Timestamp: now,
			Payload: map[string]interface{}{
				"stage":  stage.Name,
				"status": string(stage.Status),
				"source": "snapshot",
			},
		})
	}
}

func (t *TektonBackend) watchRunResource(
	ctx context.Context,
	out chan<- domain.RunEvent,
	runID string,
	source string,
	resource schema.GroupVersionResource,
	namespace string,
	options metav1.ListOptions,
) {
	options.Watch = true
	watcher, err := t.client.Resource(resource).Namespace(namespace).Watch(ctx, options)
	if err != nil {
		sendEvent(ctx, out, domain.RunEvent{
			RunID:     runID,
			Type:      "status",
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Payload: map[string]interface{}{
				"status": string(domain.StatusRunning),
				"source": source,
				"error":  err.Error(),
			},
		})
		return
	}
	go func() {
		defer watcher.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case item, ok := <-watcher.ResultChan():
				if !ok {
					return
				}
				obj, ok := item.Object.(*unstructured.Unstructured)
				if !ok {
					continue
				}
				event, ok := runEventFromWatchedObject(runID, source, item.Type, obj)
				if ok {
					sendEvent(ctx, out, event)
				}
			}
		}
	}()
}

func (t *TektonBackend) TaskRunDetail(ctx context.Context, handle domain.RunHandle, taskRunName string) (domain.TaskRunDetail, error) {
	record, err := t.record(ctx, handle.RunID)
	if err != nil {
		return domain.TaskRunDetail{}, err
	}
	taskRun, err := t.client.Resource(taskRunResource).Namespace(record.namespace).Get(ctx, taskRunName, metav1.GetOptions{})
	if err != nil {
		return domain.TaskRunDetail{}, fmt.Errorf("get TaskRun %s/%s: %w", record.namespace, taskRunName, err)
	}
	if taskRun.GetLabels()["tekton.dev/pipelineRun"] != record.pipelineRunName {
		return domain.TaskRunDetail{}, fmt.Errorf("TaskRun %s does not belong to PipelineRun %s", taskRunName, record.pipelineRunName)
	}
	startedAt, finishedAt := taskTimes(taskRun)
	return domain.TaskRunDetail{
		RunID:            handle.RunID,
		Namespace:        record.namespace,
		TaskRunName:      taskRun.GetName(),
		PipelineTaskName: pipelineTaskName(taskRun),
		PodName:          taskRunPodName(taskRun),
		Status:           conditionStatus(taskRun, domain.StatusQueued),
		StartedAt:        startedAt,
		FinishedAt:       finishedAt,
		Steps:            taskSteps(taskRun, domain.StatusQueued),
		Results:          taskResults(taskRun),
		Events:           t.taskRunEvents(ctx, record.namespace, taskRun.GetName()),
	}, nil
}

func (t *TektonBackend) TaskRunLogs(ctx context.Context, handle domain.RunHandle, taskRunName string, stepName string) (domain.TaskRunLogs, error) {
	detail, err := t.TaskRunDetail(ctx, handle, taskRunName)
	if err != nil {
		return domain.TaskRunLogs{}, err
	}
	if detail.PodName == "" {
		return domain.TaskRunLogs{}, fmt.Errorf("TaskRun %s has no podName yet", taskRunName)
	}
	if stepName == "" && len(detail.Steps) > 0 {
		stepName = detail.Steps[0].Name
	}
	container := stepContainerName(stepName)
	lines, truncated, err := t.podLogs(ctx, detail.Namespace, detail.PodName, container)
	if err != nil && container != stepName {
		lines, truncated, err = t.podLogs(ctx, detail.Namespace, detail.PodName, stepName)
		container = stepName
	}
	if err != nil {
		return domain.TaskRunLogs{}, fmt.Errorf("get logs for %s/%s container %s: %w", detail.Namespace, detail.PodName, container, err)
	}
	return domain.TaskRunLogs{
		RunID:       handle.RunID,
		Namespace:   detail.Namespace,
		TaskRunName: detail.TaskRunName,
		PodName:     detail.PodName,
		StepName:    stepName,
		Container:   container,
		Source:      "kubernetes-pod-log",
		Lines:       lines,
		Truncated:   truncated,
	}, nil
}

func (t *TektonBackend) pipelineRunName(input domain.StartRunInput) string {
	name := sanitizeDNSLabel(input.PipelineRunID)
	if name != "" {
		return name
	}
	return truncateDNSLabel(fmt.Sprintf("%s-%d", sanitizeDNSLabel(input.PipelineName), time.Now().Unix()))
}

func (t *TektonBackend) pipelineRunObject(name string, input domain.StartRunInput) *unstructured.Unstructured {
	spec := map[string]interface{}{
		"params": t.params(input),
	}
	if workspaces := workspaceBindings(input); len(workspaces) > 0 {
		spec["workspaces"] = workspaces
	}
	if t.pipelineRef != "" {
		spec["pipelineRef"] = map[string]interface{}{"name": t.pipelineRef}
	} else {
		pipelineSpec := map[string]interface{}{
			"params": t.paramSpecs(input),
			"tasks":  t.inlineTasks(input),
		}
		if workspaces := workspaceDeclarations(input); len(workspaces) > 0 {
			pipelineSpec["workspaces"] = workspaces
		}
		spec["pipelineSpec"] = pipelineSpec
	}

	return &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "tekton.dev/v1",
		"kind":       "PipelineRun",
		"metadata": map[string]interface{}{
			"name":      name,
			"namespace": t.Namespace,
			"labels": map[string]interface{}{
				"app.kubernetes.io/managed-by": "deploy-management",
				"deploy-management/run-id":     sanitizeLabelValue(input.PipelineRunID),
				"deploy-management/pipeline":   sanitizeLabelValue(input.PipelineName),
				"deploy-management/app":        sanitizeLabelValue(input.ApplicationID),
			},
			"annotations": map[string]interface{}{
				"deploy-management/run-input": compactJSON(input),
			},
		},
		"spec": spec,
	}}
}

func (t *TektonBackend) params(input domain.StartRunInput) []interface{} {
	params := []interface{}{
		map[string]interface{}{"name": "pipeline-run-id", "value": input.PipelineRunID},
		map[string]interface{}{"name": "pipeline-name", "value": input.PipelineName},
		map[string]interface{}{"name": "application-id", "value": input.ApplicationID},
		map[string]interface{}{"name": "environment", "value": input.Environment},
		map[string]interface{}{"name": "canary-percent", "value": fmt.Sprintf("%d", input.CanaryPercent)},
	}
	if len(input.Sources) > 0 {
		source := input.Sources[0]
		params = append(params,
			map[string]interface{}{"name": "git-url", "value": source.Endpoint},
			map[string]interface{}{"name": "revision", "value": firstNonEmpty(source.Branch, source.Tag)},
			map[string]interface{}{"name": "ref-type", "value": refType(source)},
		)
	}
	for _, param := range input.GlobalParams {
		if param.Key == "" {
			continue
		}
		params = append(params, map[string]interface{}{"name": param.Key, "value": param.Value})
	}
	return params
}

func (t *TektonBackend) paramSpecs(input domain.StartRunInput) []interface{} {
	seen := map[string]bool{}
	specs := []interface{}{}
	for _, raw := range t.params(input) {
		param, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		name, _ := param["name"].(string)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		specs = append(specs, map[string]interface{}{
			"name":    name,
			"type":    "string",
			"default": "",
		})
	}
	return specs
}

func (t *TektonBackend) inlineTasks(input domain.StartRunInput) []interface{} {
	tasks := make([]interface{}, 0, len(input.Stages))
	for index, stage := range input.Stages {
		task := t.inlineTask(stage, input)
		if index > 0 {
			task["runAfter"] = []interface{}{input.Stages[index-1]}
		}
		tasks = append(tasks, task)
	}
	return tasks
}

func (t *TektonBackend) inlineTask(stage string, input domain.StartRunInput) map[string]interface{} {
	if stage == "source" {
		return t.inlineSourceTask(input)
	}
	if stage == "build" {
		return t.inlineBuildTask(input)
	}
	if stage == "upload" {
		return t.inlineImageUploadTask(input)
	}
	return map[string]interface{}{
		"name": stage,
		"taskSpec": map[string]interface{}{
			"steps": []interface{}{
				map[string]interface{}{
					"name":   "run",
					"image":  t.stageImage,
					"script": t.stageScript(stage, input),
				},
			},
		},
	}
}

func (t *TektonBackend) inlineSourceTask(input domain.StartRunInput) map[string]interface{} {
	params := []string{"git-url", "revision"}
	task := map[string]interface{}{
		"name":   "source",
		"params": taskParamBindings(params),
		"taskSpec": map[string]interface{}{
			"params": taskParamSpecs(params),
			"steps": []interface{}{
				map[string]interface{}{
					"name":  "git-clone",
					"image": "alpine/git:2.45.2",
					"script": strings.Join([]string{
						"#!/bin/sh",
						"set -eu",
						"target=\"$(workspaces.source-ws.path)\"",
						"tmp=\"$target/.git-clone-tmp\"",
						"rm -rf \"$tmp\"",
						"git clone --depth=1 --branch \"$(params.revision)\" \"$(params.git-url)\" \"$tmp\" || {",
						"  git clone --depth=1 \"$(params.git-url)\" \"$tmp\"",
						"  cd \"$tmp\"",
						"  git checkout \"$(params.revision)\"",
						"  cd - >/dev/null",
						"}",
						"find \"$target\" -mindepth 1 -maxdepth 1 ! -name .git-clone-tmp -exec rm -rf {} +",
						"cp -a \"$tmp/.\" \"$target/\"",
						"rm -rf \"$tmp\"",
					}, "\n"),
				},
			},
		},
	}
	if hasWorkspaceBinding(input, "source-ws") {
		task["workspaces"] = []interface{}{
			map[string]interface{}{"name": "source-ws", "workspace": "source-ws"},
		}
		taskSpec := task["taskSpec"].(map[string]interface{})
		taskSpec["workspaces"] = []interface{}{
			map[string]interface{}{"name": "source-ws", "description": "source workspace for git checkout and build context"},
		}
	}
	if !hasWorkspaceBinding(input, "source-ws") {
		taskSpec := task["taskSpec"].(map[string]interface{})
		taskSpec["steps"] = []interface{}{
			map[string]interface{}{
				"name":   "missing-source-workspace",
				"image":  t.stageImage,
				"script": "echo 'TEKTON_SOURCE_PVC is required for inline source checkout and image build' >&2\nexit 1",
			},
		}
	}
	if gitURL := runParamValue(input, "git-url"); gitURL == "" {
		taskSpec := task["taskSpec"].(map[string]interface{})
		taskSpec["steps"] = []interface{}{
			map[string]interface{}{
				"name":   "missing-git-url",
				"image":  t.stageImage,
				"script": "echo 'git-url is required for inline source checkout' >&2\nexit 1",
			},
		}
	}
	return task
}

func (t *TektonBackend) inlineBuildTask(input domain.StartRunInput) map[string]interface{} {
	params := []string{"BUILD_CONTEXT", "PACKAGE_BUILD_SCRIPT", "PACKAGE_OUTPUT_PATHS"}
	task := map[string]interface{}{
		"name":   "build",
		"params": taskParamBindings(params),
		"taskSpec": map[string]interface{}{
			"params": taskParamSpecs(params),
			"results": []interface{}{
				map[string]interface{}{"name": "package-path", "description": "tar.gz path produced by the real build task"},
				map[string]interface{}{"name": "package-digest", "description": "sha256 digest of the generated package"},
			},
			"steps": []interface{}{
				map[string]interface{}{
					"name":  "node-package-build",
					"image": t.nodeImage,
					"script": strings.Join([]string{
						"#!/bin/sh",
						"set -eu",
						"root=\"$(workspaces.source-ws.path)\"",
						"context=\"$root/$(params.BUILD_CONTEXT)\"",
						"script_name=\"$(params.PACKAGE_BUILD_SCRIPT)\"",
						"output_paths=\"$(printf '%s' \"$(params.PACKAGE_OUTPUT_PATHS)\" | tr ',' ' ')\"",
						"cd \"$context\"",
						"artifact_dir=\"$root/.deploy-artifacts\"",
						"mkdir -p \"$artifact_dir\"",
						"package=\"$artifact_dir/build.tar.gz\"",
						"[ -f package.json ] || { echo 'package.json is required for inline Node.js package build' >&2; exit 1; }",
						"[ -n \"$script_name\" ] || { echo 'PACKAGE_BUILD_SCRIPT is required' >&2; exit 1; }",
						"[ -n \"$output_paths\" ] || { echo 'PACKAGE_OUTPUT_PATHS is required' >&2; exit 1; }",
						"node -e \"const p=require('./package.json'); const s=process.argv[1]; if (!p.scripts || !p.scripts[s]) { console.error('package.json scripts.' + s + ' is required for real package build'); process.exit(1) }\" \"$script_name\"",
						"corepack enable >/dev/null 2>&1 || true",
						"if [ -f pnpm-lock.yaml ]; then",
						"  pnpm install --frozen-lockfile",
						"  pnpm run \"$script_name\"",
						"elif [ -f package-lock.json ]; then",
						"  npm ci",
						"  npm run \"$script_name\"",
						"elif [ -f yarn.lock ]; then",
						"  yarn install --frozen-lockfile || yarn install --immutable",
						"  yarn run \"$script_name\"",
						"else",
						"  npm install",
						"  npm run \"$script_name\"",
						"fi",
						"outputs=\"\"",
						"for dir in $output_paths; do",
						"  [ -e \"$dir\" ] && outputs=\"$outputs $dir\"",
						"done",
						"[ -n \"$outputs\" ] || { echo \"build completed but no configured output directory was found: $output_paths\" >&2; exit 1; }",
						"files=\"$outputs\"",
						"for file in package.json pnpm-lock.yaml package-lock.json yarn.lock next.config.js next.config.mjs; do",
						"  [ -e \"$file\" ] && files=\"$files $file\"",
						"done",
						"tar -czf \"$package\" $files",
						"digest=\"$(sha256sum \"$package\" | awk '{print $1}')\"",
						"printf '%s' \"$package\" > \"$(results.package-path.path)\"",
						"printf 'sha256:%s' \"$digest\" > \"$(results.package-digest.path)\"",
					}, "\n"),
				},
			},
		},
	}
	if hasWorkspaceBinding(input, "source-ws") {
		task["workspaces"] = []interface{}{
			map[string]interface{}{"name": "source-ws", "workspace": "source-ws"},
		}
		taskSpec := task["taskSpec"].(map[string]interface{})
		taskSpec["workspaces"] = []interface{}{
			map[string]interface{}{"name": "source-ws", "description": "source workspace for real package build"},
		}
	} else {
		taskSpec := task["taskSpec"].(map[string]interface{})
		taskSpec["steps"] = []interface{}{
			map[string]interface{}{
				"name":   "missing-source-workspace",
				"image":  t.stageImage,
				"script": "echo 'TEKTON_SOURCE_PVC is required for real package build' >&2\nexit 1",
			},
		}
	}
	return task
}

func (t *TektonBackend) inlineImageUploadTask(input domain.StartRunInput) map[string]interface{} {
	params := []string{"REGISTRY_PROVIDER", "IMAGE_REF", "DOCKERFILE_PATH", "BUILD_CONTEXT"}
	task := map[string]interface{}{
		"name":   "upload",
		"params": taskParamBindings(params),
		"taskSpec": map[string]interface{}{
			"params": taskParamSpecs(params),
			"results": []interface{}{
				map[string]interface{}{"name": "image-digest", "description": "OCI image digest produced by the registry"},
			},
			"sidecars": []interface{}{
				map[string]interface{}{
					"name":  "docker-daemon",
					"image": t.dockerDind,
					"env": []interface{}{
						map[string]interface{}{"name": "DOCKER_TLS_CERTDIR", "value": ""},
					},
					"args": []interface{}{
						"--host=tcp://0.0.0.0:2375",
						"--storage-driver=vfs",
					},
					"securityContext": map[string]interface{}{"privileged": true},
				},
			},
			"steps": []interface{}{
				map[string]interface{}{
					"name":  "docker-build",
					"image": t.dockerCli,
					"env":   dockerStepEnv(),
					"script": strings.Join([]string{
						"#!/bin/sh",
						"set -eu",
						"mkdir -p /root/.docker",
						"until docker info >/dev/null 2>&1; do sleep 1; done",
						"root=\"$(workspaces.source-ws.path)\"",
						"context=\"$root/$(params.BUILD_CONTEXT)\"",
						"dockerfile=\"$root/$(params.DOCKERFILE_PATH)\"",
						"[ -d \"$context\" ] || { echo \"Docker build context not found: $context\" >&2; exit 1; }",
						"[ -f \"$dockerfile\" ] || { echo \"Dockerfile not found: $dockerfile\" >&2; exit 1; }",
						"docker build -f \"$dockerfile\" -t \"$(params.IMAGE_REF)\" \"$context\"",
					}, "\n"),
				},
				map[string]interface{}{
					"name":  "docker-push",
					"image": t.dockerCli,
					"env":   dockerStepEnv(),
					"script": strings.Join([]string{
						"#!/bin/sh",
						"set -eu",
						"mkdir -p /root/.docker",
						"until docker info >/dev/null 2>&1; do sleep 1; done",
						"push_log=\"/tmp/docker-push.log\"",
						"docker push \"$(params.IMAGE_REF)\" | tee \"$push_log\"",
						"digest=\"$(awk '/digest:/ {print $3; exit}' \"$push_log\")\"",
						"[ -n \"$digest\" ] || { echo 'docker push did not return a registry digest' >&2; exit 1; }",
						"printf '%s' \"$digest\" > \"$(results.image-digest.path)\"",
					}, "\n"),
				},
			},
		},
	}
	if hasWorkspaceBinding(input, "source-ws") {
		task["workspaces"] = []interface{}{
			map[string]interface{}{"name": "source-ws", "workspace": "source-ws"},
		}
		taskSpec := task["taskSpec"].(map[string]interface{})
		taskSpec["workspaces"] = []interface{}{
			map[string]interface{}{"name": "source-ws", "description": "source workspace for Docker build context"},
		}
	}
	if hasWorkspaceBinding(input, "docker-config") {
		taskWorkspaces, _ := task["workspaces"].([]interface{})
		task["workspaces"] = append(taskWorkspaces, map[string]interface{}{"name": "docker-config", "workspace": "docker-config"})

		taskSpec := task["taskSpec"].(map[string]interface{})
		taskSpecWorkspaces, _ := taskSpec["workspaces"].([]interface{})
		taskSpec["workspaces"] = append(taskSpecWorkspaces, map[string]interface{}{
			"name":        "docker-config",
			"mountPath":   "/root/.docker",
			"description": "registry docker config secret for docker push authentication",
		})
	}
	if imageRef := globalParamValue(input, "IMAGE_REF"); imageRef == "" {
		taskSpec := task["taskSpec"].(map[string]interface{})
		taskSpec["steps"] = []interface{}{
			map[string]interface{}{
				"name":   "missing-image-ref",
				"image":  t.stageImage,
				"script": "echo 'IMAGE_REF is required for real image upload' >&2\nexit 1",
			},
		}
	}
	return task
}

func (t *TektonBackend) stageScript(stage string, input domain.StartRunInput) string {
	lines := []string{
		"#!/bin/sh",
		"set -eu",
		fmt.Sprintf("echo '[deploy-management] stage=%s pipelineRun=%s application=%s env=%s'", stage, input.PipelineRunID, input.ApplicationID, input.Environment),
	}
	if len(input.Sources) > 0 {
		source := input.Sources[0]
		lines = append(lines, fmt.Sprintf("echo '[deploy-management] source=%s revision=%s'", source.Endpoint, firstNonEmpty(source.Branch, source.Tag)))
	}
	lines = append(lines,
		fmt.Sprintf("sleep %s", t.stageSleep),
		fmt.Sprintf("echo '[deploy-management] stage=%s completed'", stage),
	)
	return strings.Join(lines, "\n")
}

func (t *TektonBackend) record(ctx context.Context, runID string) (tektonRecord, error) {
	t.mu.RLock()
	record, ok := t.records[runID]
	t.mu.RUnlock()
	if ok {
		return record, nil
	}
	pr, err := t.client.Resource(pipelineRunResource).Namespace(t.Namespace).Get(ctx, runID, metav1.GetOptions{})
	if err != nil {
		return tektonRecord{}, fmt.Errorf("run %s not found: %w", runID, err)
	}
	input := inputFromAnnotation(pr)
	if len(input.Stages) == 0 {
		input.Stages = stageNamesFromPipelineRun(pr)
	}
	record = tektonRecord{
		input:           input,
		namespace:       t.Namespace,
		pipelineRunName: pr.GetName(),
		startedAt:       creationTime(pr),
	}
	t.mu.Lock()
	t.records[runID] = record
	t.mu.Unlock()
	return record, nil
}

func (t *TektonBackend) listTaskRuns(ctx context.Context, namespace string, pipelineRunName string) ([]unstructured.Unstructured, error) {
	list, err := t.client.Resource(taskRunResource).Namespace(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: fmt.Sprintf("tekton.dev/pipelineRun=%s", pipelineRunName),
	})
	if err != nil {
		return nil, fmt.Errorf("list TaskRuns for %s/%s: %w", namespace, pipelineRunName, err)
	}
	items := append([]unstructured.Unstructured(nil), list.Items...)
	sort.Slice(items, func(i, j int) bool {
		left := items[i].GetLabels()["tekton.dev/pipelineTask"]
		right := items[j].GetLabels()["tekton.dev/pipelineTask"]
		if left == right {
			return items[i].GetName() < items[j].GetName()
		}
		return left < right
	})
	return items, nil
}

func (t *TektonBackend) taskRunEvents(ctx context.Context, namespace string, taskRunName string) []domain.ObjectEvent {
	list, err := t.client.Resource(eventResource).Namespace(namespace).List(ctx, metav1.ListOptions{
		FieldSelector: fmt.Sprintf("involvedObject.name=%s", taskRunName),
	})
	if err != nil {
		return []domain.ObjectEvent{}
	}
	out := make([]domain.ObjectEvent, 0, len(list.Items))
	for _, item := range list.Items {
		out = append(out, objectEvent(&item))
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Timestamp < out[j].Timestamp
	})
	return out
}

func (t *TektonBackend) podLogs(ctx context.Context, namespace string, podName string, container string) ([]string, bool, error) {
	tail := int64(400)
	raw, err := t.core.CoreV1().Pods(namespace).GetLogs(podName, &corev1.PodLogOptions{
		Container: container,
		TailLines: &tail,
	}).DoRaw(ctx)
	if err != nil {
		return nil, false, err
	}
	text := strings.TrimRight(string(raw), "\r\n")
	if text == "" {
		return []string{}, false, nil
	}
	lines := strings.Split(text, "\n")
	for i := range lines {
		lines[i] = strings.TrimRight(lines[i], "\r")
	}
	return lines, int64(len(lines)) >= tail, nil
}

func (t *TektonBackend) stageInstances(input domain.StartRunInput, taskRuns []unstructured.Unstructured) []domain.StageInstance {
	byStage := map[string]unstructured.Unstructured{}
	for _, taskRun := range taskRuns {
		stage := pipelineTaskName(&taskRun)
		byStage[stage] = taskRun
	}

	stages := make([]domain.StageInstance, 0, len(input.Stages))
	for index, stageName := range input.Stages {
		taskRun, ok := byStage[stageName]
		if !ok {
			stages = append(stages, domain.StageInstance{
				Index:  index,
				Name:   stageName,
				Status: domain.StatusInit,
				Jobs: []domain.JobInstance{{
					ID:      fmt.Sprintf("%s-job", stageName),
					Name:    stageName,
					TaskRef: stageName,
					Status:  domain.StatusInit,
					Steps:   []domain.StepInstance{},
				}},
			})
			continue
		}
		status := conditionStatus(&taskRun, domain.StatusQueued)
		startedAt, finishedAt := taskTimes(&taskRun)
		stages = append(stages, domain.StageInstance{
			Index:  index,
			Name:   stageName,
			Status: status,
			Jobs: []domain.JobInstance{{
				ID:         taskRun.GetName(),
				Name:       stageName,
				TaskRef:    stageName,
				Status:     status,
				StartedAt:  startedAt,
				FinishedAt: finishedAt,
				DurationMs: durationMillis(startedAt, finishedAt),
				Steps:      taskSteps(&taskRun, status),
				Result:     taskResults(&taskRun),
			}},
		})
	}
	return stages
}

func loadKubernetesConfig() (*rest.Config, error) {
	if config, err := rest.InClusterConfig(); err == nil {
		return config, nil
	}
	candidates := []string{
		os.Getenv("TEKTON_BRIDGE_KUBECONFIG"),
		os.Getenv("KUBECONFIG"),
	}
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates, filepath.Join(home, ".kube", "config"))
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		config, err := clientcmd.BuildConfigFromFlags("", candidate)
		if err == nil {
			return config, nil
		}
	}
	return nil, fmt.Errorf("no Kubernetes config found: set TEKTON_BRIDGE_KUBECONFIG, KUBECONFIG, or run in cluster")
}

func conditionStatus(obj *unstructured.Unstructured, fallback domain.JobStatus) domain.JobStatus {
	conditions, ok, _ := unstructured.NestedSlice(obj.Object, "status", "conditions")
	if !ok || len(conditions) == 0 {
		return fallback
	}
	for _, raw := range conditions {
		condition, ok := raw.(map[string]interface{})
		if !ok || condition["type"] != "Succeeded" {
			continue
		}
		status, _ := condition["status"].(string)
		reason, _ := condition["reason"].(string)
		switch status {
		case "True":
			return domain.StatusSuccess
		case "False":
			if strings.Contains(strings.ToLower(reason), "cancel") {
				return domain.StatusCanceled
			}
			return domain.StatusFail
		case "Unknown":
			return domain.StatusRunning
		}
	}
	return fallback
}

func pipelineTimes(obj *unstructured.Unstructured, fallback time.Time) (string, string) {
	startedAt, _, _ := unstructured.NestedString(obj.Object, "status", "startTime")
	if startedAt == "" && !fallback.IsZero() {
		startedAt = fallback.UTC().Format(time.RFC3339)
	}
	completionTime, _, _ := unstructured.NestedString(obj.Object, "status", "completionTime")
	return startedAt, completionTime
}

func taskTimes(obj *unstructured.Unstructured) (string, string) {
	startedAt, _, _ := unstructured.NestedString(obj.Object, "status", "startTime")
	completionTime, _, _ := unstructured.NestedString(obj.Object, "status", "completionTime")
	return startedAt, completionTime
}

func pipelineTaskName(obj *unstructured.Unstructured) string {
	if value := obj.GetLabels()["tekton.dev/pipelineTask"]; value != "" {
		return value
	}
	return obj.GetName()
}

func taskRunPodName(obj *unstructured.Unstructured) string {
	podName, _, _ := unstructured.NestedString(obj.Object, "status", "podName")
	return podName
}

func taskSteps(obj *unstructured.Unstructured, fallback domain.JobStatus) []domain.StepInstance {
	steps, ok, _ := unstructured.NestedSlice(obj.Object, "status", "steps")
	if !ok {
		return []domain.StepInstance{}
	}
	out := make([]domain.StepInstance, 0, len(steps))
	for index, raw := range steps {
		step, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		name, _ := step["name"].(string)
		if name == "" {
			name = fmt.Sprintf("step-%d", index)
		}
		out = append(out, domain.StepInstance{
			ID:       fmt.Sprintf("%s-%d", name, index),
			Name:     name,
			Image:    stringFromNestedMap(step, "imageID"),
			Status:   stepStatus(step, fallback),
			ExitCode: exitCode(step),
		})
	}
	return out
}

func stepContainerName(stepName string) string {
	stepName = strings.TrimSpace(stepName)
	if stepName == "" {
		return ""
	}
	if strings.HasPrefix(stepName, "step-") {
		return stepName
	}
	return "step-" + stepName
}

func taskResults(obj *unstructured.Unstructured) map[string]string {
	out := map[string]string{}
	for _, field := range []string{"taskResults", "results"} {
		results, ok, _ := unstructured.NestedSlice(obj.Object, "status", field)
		if !ok {
			continue
		}
		for _, raw := range results {
			result, ok := raw.(map[string]interface{})
			if !ok {
				continue
			}
			name, _ := result["name"].(string)
			if name == "" {
				continue
			}
			switch value := result["value"].(type) {
			case string:
				out[name] = value
			default:
				out[name] = compactJSON(value)
			}
		}
	}
	return out
}

func stepStatus(step map[string]interface{}, fallback domain.JobStatus) domain.JobStatus {
	if terminated, ok := nestedMap(step, "terminated"); ok {
		code, _ := int64Value(terminated["exitCode"])
		if code == 0 {
			return domain.StatusSuccess
		}
		return domain.StatusFail
	}
	if _, ok := nestedMap(step, "running"); ok {
		return domain.StatusRunning
	}
	if _, ok := nestedMap(step, "waiting"); ok {
		return domain.StatusQueued
	}
	return fallback
}

func exitCode(step map[string]interface{}) *int {
	terminated, ok := nestedMap(step, "terminated")
	if !ok {
		return nil
	}
	value, ok := int64Value(terminated["exitCode"])
	if !ok {
		return nil
	}
	intValue := int(value)
	return &intValue
}

func int64Value(value interface{}) (int64, bool) {
	switch typed := value.(type) {
	case int64:
		return typed, true
	case int:
		return int64(typed), true
	case float64:
		return int64(typed), true
	default:
		return 0, false
	}
}

func durationMillis(startedAt string, finishedAt string) int64 {
	if startedAt == "" || finishedAt == "" {
		return 0
	}
	start, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return 0
	}
	finish, err := time.Parse(time.RFC3339, finishedAt)
	if err != nil {
		return 0
	}
	return finish.Sub(start).Milliseconds()
}

func stageNamesFromPipelineRun(obj *unstructured.Unstructured) []string {
	tasks, ok, _ := unstructured.NestedSlice(obj.Object, "spec", "pipelineSpec", "tasks")
	if !ok {
		return []string{}
	}
	names := make([]string, 0, len(tasks))
	for _, raw := range tasks {
		task, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		if name, _ := task["name"].(string); name != "" {
			names = append(names, name)
		}
	}
	return names
}

func inputFromAnnotation(obj *unstructured.Unstructured) domain.StartRunInput {
	raw := obj.GetAnnotations()["deploy-management/run-input"]
	var input domain.StartRunInput
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &input)
	}
	return input
}

func creationTime(obj *unstructured.Unstructured) time.Time {
	createdAt := obj.GetCreationTimestamp()
	if !createdAt.IsZero() {
		return createdAt.Time
	}
	return time.Now().UTC()
}

func workspaceBindings(input domain.StartRunInput) []interface{} {
	var bindings []interface{}
	if pvc := os.Getenv("TEKTON_SOURCE_PVC"); pvc != "" {
		bindings = append(bindings, map[string]interface{}{"name": "source-ws", "persistentVolumeClaim": map[string]interface{}{"claimName": pvc}})
	}
	if pvc := os.Getenv("TEKTON_CACHE_PVC"); pvc != "" {
		bindings = append(bindings, map[string]interface{}{"name": "cache-ws", "persistentVolumeClaim": map[string]interface{}{"claimName": pvc}})
	}
	if secret := dockerSecretName(input); secret != "" {
		bindings = append(bindings, map[string]interface{}{"name": "docker-config", "secret": map[string]interface{}{"secretName": secret}})
	}
	if secret := os.Getenv("TEKTON_KUBECONFIG_SECRET"); secret != "" {
		bindings = append(bindings, map[string]interface{}{"name": "kubeconfig", "secret": map[string]interface{}{"secretName": secret}})
	}
	return bindings
}

func workspaceDeclarations(input domain.StartRunInput) []interface{} {
	var declarations []interface{}
	if hasWorkspaceBinding(input, "source-ws") {
		declarations = append(declarations, map[string]interface{}{"name": "source-ws"})
	}
	if hasWorkspaceBinding(input, "cache-ws") {
		declarations = append(declarations, map[string]interface{}{"name": "cache-ws", "optional": true})
	}
	if hasWorkspaceBinding(input, "docker-config") {
		declarations = append(declarations, map[string]interface{}{"name": "docker-config", "optional": true})
	}
	if hasWorkspaceBinding(input, "kubeconfig") {
		declarations = append(declarations, map[string]interface{}{"name": "kubeconfig", "optional": true})
	}
	return declarations
}

func hasWorkspaceBinding(input domain.StartRunInput, name string) bool {
	switch name {
	case "source-ws":
		return os.Getenv("TEKTON_SOURCE_PVC") != ""
	case "cache-ws":
		return os.Getenv("TEKTON_CACHE_PVC") != ""
	case "docker-config":
		return dockerSecretName(input) != ""
	case "kubeconfig":
		return os.Getenv("TEKTON_KUBECONFIG_SECRET") != ""
	default:
		return false
	}
}

func dockerSecretName(input domain.StartRunInput) string {
	return firstNonEmpty(globalParamValue(input, "REGISTRY_DOCKER_SECRET"), os.Getenv("TEKTON_DOCKER_SECRET"))
}

func registryFromImageRef(imageRef string) string {
	parts := strings.Split(strings.TrimSpace(imageRef), "/")
	if len(parts) < 2 {
		return ""
	}
	return parts[0]
}

func dockerStepEnv() []interface{} {
	return []interface{}{
		map[string]interface{}{"name": "DOCKER_HOST", "value": "tcp://localhost:2375"},
		map[string]interface{}{"name": "DOCKER_TLS_CERTDIR", "value": ""},
		map[string]interface{}{"name": "DOCKER_CONFIG", "value": "/root/.docker"},
	}
}

func taskParamBindings(names []string) []interface{} {
	params := make([]interface{}, 0, len(names))
	for _, name := range names {
		params = append(params, map[string]interface{}{
			"name":  name,
			"value": fmt.Sprintf("$(params.%s)", name),
		})
	}
	return params
}

func taskParamSpecs(names []string) []interface{} {
	params := make([]interface{}, 0, len(names))
	for _, name := range names {
		params = append(params, map[string]interface{}{
			"name": name,
			"type": "string",
		})
	}
	return params
}

func globalParamValue(input domain.StartRunInput, key string) string {
	for _, param := range input.GlobalParams {
		if param.Key == key {
			return param.Value
		}
	}
	return ""
}

func stages(input domain.StartRunInput) map[string]bool {
	out := map[string]bool{}
	for _, stage := range input.Stages {
		out[stage] = true
	}
	return out
}

func runParamValue(input domain.StartRunInput, key string) string {
	switch key {
	case "git-url":
		if len(input.Sources) > 0 {
			return input.Sources[0].Endpoint
		}
	case "revision":
		if len(input.Sources) > 0 {
			return firstNonEmpty(input.Sources[0].Branch, input.Sources[0].Tag)
		}
	case "ref-type":
		if len(input.Sources) > 0 {
			return refType(input.Sources[0])
		}
	}
	return globalParamValue(input, key)
}

func sendEvent(ctx context.Context, out chan<- domain.RunEvent, event domain.RunEvent) {
	select {
	case <-ctx.Done():
	case out <- event:
	}
}

func runEventFromWatchedObject(runID string, source string, watchType watch.EventType, obj *unstructured.Unstructured) (domain.RunEvent, bool) {
	if obj == nil {
		return domain.RunEvent{}, false
	}
	creationTimestamp := obj.GetCreationTimestamp()
	timestamp := creationTimestamp.UTC().Format(time.RFC3339)
	if creationTimestamp.Time.IsZero() {
		timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	payload := map[string]interface{}{
		"source":          source,
		"watchType":       string(watchType),
		"apiVersion":      obj.GetAPIVersion(),
		"kind":            obj.GetKind(),
		"namespace":       obj.GetNamespace(),
		"name":            obj.GetName(),
		"uid":             string(obj.GetUID()),
		"resourceVersion": obj.GetResourceVersion(),
	}
	switch source {
	case "pipelinerun":
		payload["status"] = string(conditionStatus(obj, domain.StatusRunning))
	case "taskrun":
		payload["pipelineTaskName"] = pipelineTaskName(obj)
		payload["podName"] = taskRunPodName(obj)
		payload["status"] = string(conditionStatus(obj, domain.StatusQueued))
		payload["results"] = taskResults(obj)
	case "pod":
		phase, _, _ := unstructured.NestedString(obj.Object, "status", "phase")
		payload["phase"] = phase
	case "kubernetes-event":
		event := objectEvent(obj)
		payload["reason"] = event.Reason
		payload["message"] = event.Message
		payload["involvedObject"] = event.InvolvedObject
	default:
		return domain.RunEvent{}, false
	}
	return domain.RunEvent{
		RunID:     runID,
		Type:      source,
		Timestamp: timestamp,
		Payload:   payload,
	}, true
}

func objectEvent(obj *unstructured.Unstructured) domain.ObjectEvent {
	involved, _, _ := unstructured.NestedMap(obj.Object, "involvedObject")
	eventTime, _, _ := unstructured.NestedString(obj.Object, "eventTime")
	if eventTime == "" {
		eventTime, _, _ = unstructured.NestedString(obj.Object, "lastTimestamp")
	}
	if eventTime == "" {
		eventTime = obj.GetCreationTimestamp().UTC().Format(time.RFC3339)
	}
	eventType, _, _ := unstructured.NestedString(obj.Object, "type")
	reason, _, _ := unstructured.NestedString(obj.Object, "reason")
	message, _, _ := unstructured.NestedString(obj.Object, "message")
	return domain.ObjectEvent{
		Type:      firstNonEmpty(eventType, "Normal"),
		Reason:    reason,
		Message:   message,
		Timestamp: eventTime,
		InvolvedObject: domain.ObjectRef{
			APIVersion: stringValue(involved["apiVersion"]),
			Kind:       stringValue(involved["kind"]),
			Namespace:  stringValue(involved["namespace"]),
			Name:       stringValue(involved["name"]),
			UID:        stringValue(involved["uid"]),
		},
	}
}

func isTerminal(status domain.JobStatus) bool {
	return status == domain.StatusSuccess || status == domain.StatusFail || status == domain.StatusCanceled
}

func nestedMap(value map[string]interface{}, key string) (map[string]interface{}, bool) {
	raw, ok := value[key]
	if !ok {
		return nil, false
	}
	typed, ok := raw.(map[string]interface{})
	return typed, ok
}

func stringFromNestedMap(value map[string]interface{}, key string) string {
	raw, _ := value[key].(string)
	return raw
}

func stringValue(value interface{}) string {
	typed, _ := value.(string)
	return typed
}

func compactJSON(value interface{}) string {
	data, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func refType(source domain.PipelineSource) string {
	if source.Tag != "" {
		return "tag"
	}
	return "branch"
}

func envOr(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func sanitizeDNSLabel(value string) string {
	value = strings.ToLower(value)
	var builder strings.Builder
	lastDash := false
	for _, r := range value {
		valid := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if valid {
			builder.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteRune('-')
			lastDash = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

func truncateDNSLabel(value string) string {
	value = sanitizeDNSLabel(value)
	if len(value) <= 63 {
		return value
	}
	return strings.Trim(value[:63], "-")
}

func sanitizeLabelValue(value string) string {
	value = sanitizeDNSLabel(value)
	if len(value) <= 63 {
		return value
	}
	return strings.Trim(value[:63], "-")
}
