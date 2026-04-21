# Guided Scenario Flow — Terminal Agent

## Demo intent

Show a real terminal-centric engineering task running on System A with visible command execution and a concrete result.

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
- system owner: System A
- inference may assist, but the demo must show actual terminal execution
- do not turn this into a vague conversational answer

## Execution expectations

The scenario should look like a mini Terminal Bench style run:
- identify a bounded terminal task
- run a sequence of real commands
- solve the reference task defined in `agents/scenarios/terminal-agent/terminal-bench-reference.md` unless a better bounded repo task is chosen
- check outputs against an explicit success condition
- return a concise engineering summary with evidence

## Minimum evidence to show

Include evidence for:
- workspace/task inspection
- at least one real shell command sequence
- validation command or check
- final status

## Failure handling

If a command cannot run or the environment lacks the expected repo/tooling:
- say exactly which step was blocked
- still provide the partial evidence gathered
- suggest the next corrective action
