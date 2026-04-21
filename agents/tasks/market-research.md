# Task Brief: Market Research

## Goal

Generate a market research style output by orchestrating on System A and offloading compute to System B.

## In scope

- classify as analytics/report workflow
- prepare offload job
- collect results
- return report summary

## Out of scope

- re-routing based on preference
- storing user state on System B
- bypassing offload contract

## Expected route

offload_system_b

## Acceptance checks

- task was sent through offload path
- System B returned structured result
- final report summary was returned to the user
