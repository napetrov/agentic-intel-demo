# Task Brief — <Scenario Label>

## Objective

<One-sentence statement of what this run should accomplish. Must be
bounded, observable, and reproducible.>

## Inputs

<Explicit list of inputs the agent is allowed to consume. Examples:
- path to a target repo or file
- a structured question
- a dataset ref in MinIO
- a named configuration>

## Steps

1. <ordered, concrete action>
2. <ordered, concrete action>
3. <ordered, concrete action>
4. <ordered, concrete action>

Each step should map to a command, a tool call, or a well-defined agent
action. Avoid steps that are purely narrative.

## Success criteria

The run is successful if and only if all of the following are true:
- <observable condition 1, e.g., "exit code of build command is 0">
- <observable condition 2, e.g., "all expected test counts appear in output">
- <observable condition 3, e.g., "artifact ref returned and fetchable via
  Control Plane">

## Allowed tools

<List the tool scope the agent may use for this task. Examples: `shell`,
`git`, `python`, `build_tools`, `analytics_tools`. Unlisted tools must not
be used for this scenario.>

## Out of scope

<Explicit list of things the agent must not do in this scenario. Examples:
- do not offload to System B
- do not modify files outside the workspace
- do not call external APIs other than the configured model endpoint>

## Evidence to capture

- <command transcripts>
- <artifact refs>
- <job ids>
- <final structured summary>
