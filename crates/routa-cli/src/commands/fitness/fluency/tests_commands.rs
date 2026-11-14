use super::types::{CriterionStatus, FluencyMode, ReportFraming};
use super::{evaluate_harness_fluency, EvaluateOptions};
use std::fs::{create_dir_all, write};
use tempfile::tempdir;

#[test]
fn command_output_regex_judges_stdout_not_stderr_noise() {
    let repo = tempdir().unwrap();
    let repo_root = repo.path();
    create_dir_all(repo_root.join("docs/fitness")).unwrap();
    write(repo_root.join("README.md"), "# repo\n").unwrap();

    let model_path = repo_root.join("docs/fitness/model.yaml");
    let snapshot_path = repo_root.join("docs/fitness/latest.json");
    write(
        &model_path,
        r#"version: 1
levels:
  - id: awareness
    name: Awareness
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.marker
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: a second criterion keeps the cell valid
    recommended_action: add a marker file
    evidence_hint: README.md
    detector:
      type: file_exists
      path: README.md
  - id: collaboration.awareness.stdout_answer
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: stdout is the command answer
    recommended_action: assert on stdout
    evidence_hint: node -e ...
    detector:
      type: command_output_regex
      command: node -e "process.stderr.write('proxy-warning-noise'); process.stdout.write('ok')"
      pattern: ^ok$
      flags: ""
"#,
    )
    .unwrap();

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root: repo_root.to_path_buf(),
        model_path,
        profile: "generic".to_string(),
        mode: FluencyMode::Deterministic,
        framing: ReportFraming::Fluency,
        snapshot_path,
        compare_last: false,
        save: false,
    })
    .expect("report");

    let criterion = report
        .criteria
        .iter()
        .find(|criterion| criterion.id == "collaboration.awareness.stdout_answer")
        .expect("criterion present");
    assert_eq!(
        criterion.status,
        CriterionStatus::Pass,
        "stderr diagnostics must not decide the match: {}",
        criterion.detail
    );
}

#[test]
fn command_output_regex_still_matches_diagnostics_on_stderr() {
    let repo = tempdir().unwrap();
    let repo_root = repo.path();
    create_dir_all(repo_root.join("docs/fitness")).unwrap();
    write(repo_root.join("README.md"), "# repo\n").unwrap();

    let model_path = repo_root.join("docs/fitness/model.yaml");
    let snapshot_path = repo_root.join("docs/fitness/latest.json");
    write(
        &model_path,
        r#"version: 1
levels:
  - id: awareness
    name: Awareness
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.marker
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: a second criterion keeps the cell valid
    recommended_action: add a marker file
    evidence_hint: README.md
    detector:
      type: file_exists
      path: README.md
  - id: collaboration.awareness.stderr_signal
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: some checks target diagnostics
    recommended_action: keep stderr reachable
    evidence_hint: node -e ...
    detector:
      type: command_output_regex
      command: node -e "process.stdout.write('ok'); process.stderr.write('diag-42')"
      pattern: diag-[0-9]+
      flags: ""
"#,
    )
    .unwrap();

    let report = evaluate_harness_fluency(&EvaluateOptions {
        repo_root: repo_root.to_path_buf(),
        model_path,
        profile: "generic".to_string(),
        mode: FluencyMode::Deterministic,
        framing: ReportFraming::Fluency,
        snapshot_path,
        compare_last: false,
        save: false,
    })
    .expect("report");

    let criterion = report
        .criteria
        .iter()
        .find(|criterion| criterion.id == "collaboration.awareness.stderr_signal")
        .expect("criterion present");
    assert_eq!(
        criterion.status,
        CriterionStatus::Pass,
        "stderr-only patterns keep working through the fallback: {}",
        criterion.detail
    );
}
