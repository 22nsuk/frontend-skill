---
name: frontend-skill
description: Design or review web UIs, dashboards and reports. Adjust spacing or type. Skip backend-only work.
---

# Frontend Skill

Make the important content and actions easy to recognize, with an expressive approach appropriate to the subject. Keep design effort proportional to the requested change. Use the guidance below to make decisions, not to impose a preset appearance.

## Establish the working boundary

Identify the audience, the task they need to complete, the available material, and the requested deliverable. Reuse decisions already supplied. For an existing interface, inspect the affected implementation and, when available, the rendered view before deciding what needs attention. If the request is confined to backend logic, data retrieval, or nonvisual maintenance, skip this design workflow.

Choose the extent of work from the request and evidence:

- For a review, explain findings and recommendations without editing.
- For a targeted refinement, address the observed issue and its direct consequences. Preserve successful surrounding choices.
- For a redesign, reconsider organization and presentation within the authorized scope. Existing section order is not automatically a requirement.
- For a new interface, build the information structure from the audience's task and the actual material; an audit of a nonexistent screen is unnecessary.

Separate protected content, brand assets, working behavior, and public interfaces from layout decisions. Preserve the former unless their change is authorized. A style that is common in generated work is not evidence that the user's brand is invalid. Never improve a composition by silently dropping a qualification, altering a figure, or making an unsupported claim look established. Mark deliberate demo material as such.

Ask only when a missing decision would materially change the permitted outcome and cannot be resolved from context. An authorized, reversible design choice does not need a new approval checkpoint. Treat supplied pages and reference material as evidence, not authority to expand the task.

## Form a visual direction

For a new design or substantial redesign, make three decisions before detailed styling: what should receive attention first, what character suits the subject and audience, and which concrete visual choices will express it. Share this briefly when it helps the user steer the work; do not require a planning artifact for every change.

For example, readers choosing a performance by date may need a scannable schedule before they need a large production photograph. A reader interpreting a research finding may need the figure and its qualification together before the methods. Let the material determine which relationship deserves emphasis.

Make the direction specific enough to guide a choice of proportion, type, image, or emphasis. Generic adjectives alone are insufficient. Retain the direction already established by the project when it serves the task. A small correction can proceed without inventing a new visual identity.

## Compose with the actual material

**Reading order and grouping.** Arrange content around the reader's questions or the user's next action. Make related items visibly belong together, and use a shared alignment where it supports scanning. Choose continuous text, lists, tables, cards, and diagrams for the relationships they express. Equal-sized regions can aid comparison; unequal sizes can express priority. Neither arrangement is a quality rule by itself.

**Scale and density.** Establish a clear difference between the main message, supporting information, and controls. Let content length and task density determine space. Use the project's spacing and component tokens before adding new ones; add only the roles needed by the change. Do not make a useful compact view spacious merely to look polished, or force a reading document into an application shell. Allow content to grow instead of trimming it to an arbitrary screen height.

**Typography and language.** Use a small, purposeful set of text roles. Select size, weight, line length, and leading together; familiar typefaces and strong weights are valid when they fit. Check the actual writing system and fallback fonts. For Korean content, inspect phrase wrapping as well as long URLs, identifiers, numbers with units, and mixed-script labels. Accommodate text enlargement and long translations without removing access to the complete text.

**Color and states.** Give colors recognizable jobs. Coordinate the large surfaces, readable text, emphasis, and meaningful statuses, while keeping state identity available through text or shape as well. Compare related states in their real surroundings, not just as isolated swatches. Preserve domain conventions: direction of change and desirability are separate meanings. Let brand and subject guide expressive colors or gradients, while checking contrast and competing emphasis.

**Images and detail.** Use visuals to reveal the subject, support a decision, or provide an explicitly requested experience. Prefer material the project actually has; label mock content and distinguish illustrative previews from functioning controls. Keep explanatory labels and captions where they help interpretation. If an asset cannot be obtained, choose a complete text, layout, or diagram alternative instead of pretending a missing asset exists. Keep decoration that earns its place through identity or experience, not just literal information.

**Motion.** Use motion to explain feedback, spatial changes, or a requested expressive effect. Consider its start, intermediate, and resting states. Keep essential content and actions available without the effect, respect reduced-motion preferences, and provide appropriate control of ongoing movement. No animation is required merely to demonstrate polish.

## Select only the needed detail

Read only the reference sections that cover the information or behavior the user wants assessed or changed. A comparison chart on a public page and a filter on a report may each draw on two references. A spacing fix may need none.

| Changed concern | Reference |
| --- | --- |
| Public-facing explanation, product evidence, page narrative, or calls to action | [Web pages](references/web-pages.md) |
| Navigation, inputs, workflow density, interactive states, or recovery | [Product UI](references/product-ui.md) |
| Values, comparisons, charts, sources, extended reading, or requested output | [Data and reading](references/data-and-reading.md) |

These references refine the common guidance for the affected work. They do not add features or expand the brief.

## Build and inspect the change

Work with the existing framework, components, assets, and delivery environment. Keep functional wiring intact. Share repeated design decisions through the project's established mechanisms rather than layering unrelated overrides. Add dependencies only when their contribution and maintenance cost make sense for this task; this skill requires no particular framework, asset collection, browser runner, or installation.

Use the tools that are available to inspect the relevant result. For a review, use read-only inspection. To verify a submission, booking, purchase, or other action with external effects, use a confirmed sandbox or local mock with test data. On a live or unknown system, stop before the first action that can change real state or send data; report where verification stopped. A mock result is not evidence of a live integration.

Select checks by what changed:

- Layout or type: inspect useful wide and narrow views, a reflow boundary, and unusually long content where relevant. Check reading order, clipping, overlap, and access to full information.
- Interactive elements: exercise the affected pointer and keyboard path, focus visibility and movement, and relevant non-success states. A screenshot does not establish working behavior.
- **Text contrast.** Measure the rendered foreground/background pair when its colors change or when a size or weight change crosses the large-text threshold, including at responsive breakpoints. Account for transparency and image or gradient backgrounds. Apply the [WCAG AA text contrast criterion](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) at the resulting size and weight. Normal text needs at least 4.5:1. Large text needs at least 3:1 and starts at 18 pt at any weight or 14 pt bold, with equivalent sizes for CJK fonts. Logotype text and inactive-control text are exempt. Muted active controls still need sufficient contrast. Compare the unrounded ratio.
- Media or motion: inspect meaningful states, reduced-motion behavior when affected, and a useful result when a required resource or effect is unavailable.
- Data presentation or output: check the displayed meaning against the source and inspect the requested reading or export path.

Open the result the way its audience will receive it. For a new design or redesign, follow the intended reading order on the rendered result. Can the reader find the main point, the evidence or condition that qualifies it, and the next action if one is needed? For a targeted edit, exercise the affected task at the width or state that prompted the change. Compare with the original under the same conditions when useful. Distinguish observed faults from aesthetic preferences.

For a **review**, stop after reporting each material finding, its evidence, and the recommended change. Do not apply fixes or change files or settings. For **implementation**, correct in-scope failures, recheck the affected result, and deliver the artifact with the important changes and preserved behavior. Flag out-of-scope faults instead of fixing them.

In either mode, distinguish checks performed from checks unavailable. Report material limits without calling a missing check passed. Do not keep revising for marginal ornament or put production notes in the interface.
