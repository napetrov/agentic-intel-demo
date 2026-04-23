# Guided Scenario Flow — Terminal Agent (example, local-standard)

Worked example of `flow.template.md` for the `terminal_agent` built-in
scenario. The live, authoritative file is
`agents/scenarios/terminal-agent/flow.md`.

## Demo intent

Show a real terminal-centric engineering task running on System A with
visible command execution and a concrete result.

## Required opening

Start with:
`Starting isolated engineering demo`

Then immediately state the operator-friendly flow:
1. prepare isolated engineering workspace
2. inspect the task brief
3. run a real terminal task
4. validate the result
5. summarize evidence

## Scenario contract

- route: `local_standard`
- system owner: System A (no System B compute)
- tool scope: terminal, file, git, python
- do not turn this into a vague conversational answer

## Execution expectations

Terminal Bench style:
- identify a bounded terminal task
- run a sequence of real commands
- check outputs against an explicit success condition
- return a concise engineering summary with evidence

## Minimum evidence to show

- workspace/task inspection
- at least one real shell command sequence
- validation command or check
- final status

## Failure handling

If a command cannot run or the environment lacks the expected tooling:
- say exactly which step was blocked
- still provide the partial evidence gathered
- suggest the next corrective action
- no fallback scenario (fallback_scenario is null)

## Final result shape

Follow `templates/result-summary.md`.
