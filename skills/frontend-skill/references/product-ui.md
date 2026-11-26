# Product interface changes

Use this reference when an edit affects input, navigation, retained state, submission, cancellation, or recovery. Select it by the behavior that changes, regardless of the page's label. Keep the work proportional to the requested change.

## Preserve the working path

- Follow the affected task from its entry point to completion or exit. Preserve permission boundaries, validation rules, navigation context, and established behavior outside the requested scope.
- Keep unsaved input through recoverable errors and incidental interface changes. Follow existing save, autosave, and discard behavior; make intentional loss apparent before it happens. Avoid adding confirmations that the workflow does not need.
- Reuse the application's components, routing conventions, form patterns, and available stack. Extend the component responsible for the behavior instead of creating a competing implementation or introducing a package for a local adjustment.

## Organize information around the task

- Group related fields, values, and actions so users can understand their relationship without reconstructing it from distant parts of the screen.
- Set density according to the work: comparison needs nearby values, repeated editing needs predictable controls, and occasional decisions need clear context. Preserve useful information rather than hiding it merely to simplify the composition.
- Distinguish the current action from alternatives. Place consequences and relevant constraints where the decision occurs. Keep secondary detail available when it helps users choose or recover.

## Make interaction understandable

- Use native buttons, links, inputs, and form semantics where they fit. Give controls meaningful accessible names and associate instructions and errors with the relevant fields.
- Support the affected flow with the keyboard. Keep focus visible, preserve a logical traversal order, and move or restore focus deliberately when a dialog closes or its originating control disappears.
- Explain unavailable actions when the reason matters. Preserve the difference between read-only information, disabled controls, and actions the user lacks permission to perform; visual treatment does not enforce authorization.

## Represent state truthfully

- Cover the states the affected path can actually reach: loading, empty, stale, error, success, and cancellation. Separate an empty result from a failed request and distinguish retained data from refreshed data when freshness matters.
- Show success only after the operation's real completion condition. Preserve useful input on failure, provide the available recovery action, and prevent accidental repeated submission while a request is pending.
- When progress, success, or error text changes without moving focus, expose the change to assistive technology. Check the updated text and its live-region semantics or equivalent notification. Distinguish inspection of these properties from a test with a screen reader.
- Keep displayed and effective values aligned, including defaults, filters, units, selected items, and disabled choices. A visible cancellation control must have a defined effect; do not imply that it reverses completed work.

## Check the changed behavior

When a submission changes, try its established keyboard and pointer paths with valid input. Check that client-side validation still blocks the inputs it previously rejected and that server-side errors reach the user. Compare the test request's method, destination, encoding, and field values with the existing contract. For a navigation layout change, activate the destination at the affected width using the available menu or scrolling interaction.

For an illustrative product preview, make simulated behavior and sample data clear. Inspect its presentation and any implemented interactions, but do not treat a convincing mockup as evidence of persistence, permissions, or service integration.
