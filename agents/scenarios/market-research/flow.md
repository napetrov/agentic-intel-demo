# Guided Scenario Flow — Market Research

## Demo intent

Show System A orchestrating a structured market-research workflow while System B acts as the offload backend for heavier analysis.

## Required opening

Start with:
`Starting market research demo`

Then state the flow briefly:
1. frame the question
2. prepare structured analysis inputs
3. offload analysis to System B
4. collect findings
5. return a concise report

## Scenario contract

- route: `offload_system_b`
- System A owns user interaction, routing, and result delivery
- System B owns offloaded analytics execution only

## Required output shape

The final answer should read like a compact analyst note:
- question/objective
- approach
- findings
- evidence or structured support
- recommended next step

## Minimum detail

Show concrete subtasks such as:
- market framing
- comparison dimensions
- analysis categories
- structured result collection
