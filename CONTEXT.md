# CSVChat

A chat-based data analysis tool: users upload several CSV files and ask questions in natural language, receiving text answers, charts, or a mix of both.

## Language

**Chat**:
A resumable conversation identified by a unique chat id, owning one Dataset. Anyone holding the chat id can resume it.
_Avoid_: Session, thread, conversation

**Dataset**:
The set of Tables a Chat has been given through uploads. Belongs to exactly one Chat and is never shared between Chats.
_Avoid_: Workspace, database, project

**Table**:
One uploaded CSV file after cleaning, queryable alongside the other Tables in its Dataset.
_Avoid_: File, sheet (once ingested)

**Relationship**:
An inferred join between a column in one Table and a column in another, based on matching names and overlapping values.
_Avoid_: Foreign key, link

**Schema Profile**:
The description of a Dataset handed to the agents: each Table's columns, types, sample values, and its Relationships.
_Avoid_: Metadata, catalog

**Cleaning Report**:
The per-Table record of what ingestion changed or flagged (type fixes, removed duplicate rows, null-marker conversions, flagged outliers). Outliers are flagged, never removed.
_Avoid_: Audit log, validation result

**Dataset Notes**:
Free-text business definitions supplied with a Dataset (for example what counts as revenue) that the agents must follow.
_Avoid_: Glossary, config, metrics file

**As-of Date**:
The "today" supplied by the user for a Chat; all relative time phrases ("past year", "last 6 months") are resolved against it.
_Avoid_: Current date, anchor date, system date

**Revenue** (Online Shop dataset):
The sum of order total price for orders whose payment is Completed and whose shipment is not Cancelled. Payment amounts are not used because they disagree with order totals.
_Avoid_: Sales, income

## Agents

**Orchestrator**:
The agent that receives the user's question, splits it into independent tasks, delegates them to Sub-agents, and passes the results on for the final answer.
_Avoid_: Supervisor, router, planner

**Sub-agent**:
An agent that performs one delegated task for the Orchestrator. There are three kinds: SQL Analyst, Chart Builder, Synthesizer.
_Avoid_: Worker, tool

**SQL Analyst**:
A Sub-agent that answers one independent sub-question by querying the Dataset. Several run in parallel for a multi-part question.

**Chart Builder**:
A Sub-agent that turns a query result into a Chart Spec.

**Synthesizer**:
A Sub-agent that merges all results into the final answer shown to the user.

## Responses

**Answer**:
What the user receives for one question: text, one or more Charts, or both, as the question warrants.
_Avoid_: Reply, output

**Chart Spec**:
A declarative description of a chart (type, axes, series, title, data) that the frontend draws. Never code.
_Avoid_: Figure, image, plot code
