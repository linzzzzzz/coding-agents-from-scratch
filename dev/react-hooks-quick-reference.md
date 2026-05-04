# React Hooks Quick Reference

## useState

Remember data and rerender the UI when it changes.

```tsx
const [input, setInput] = useState("");
```

Use it when the UI should update after the value changes.

Examples:

- User input text
- Message list
- Loading state
- Error state

Mental model:

```text
useState = remember value, update UI when changed
```

## useRef

Remember data without rerendering the UI when it changes.

```tsx
const usageTrackerRef = useRef(new UsageTracker(DEFAULT_USAGE_LIMITS));
```

Use it when you need to keep the same object or value around, but changing it should not redraw the UI.

Examples:

- Usage tracker
- Timer ID
- DOM reference
- Previous value

Mental model:

```text
useRef = remember value, do not update UI when changed
```

## useEffect

Run side effects after render.

```tsx
useEffect(() => {
  void loadMemory();
}, []);
```

Use it for work outside pure UI rendering.

Examples:

- Load saved conversation
- Subscribe to events
- Start or stop timers
- Sync with local storage or files

Mental model:

```text
useEffect = run side effect after render
```

## useCallback

Remember a function so React does not recreate it every render.

```tsx
const handleSubmit = useCallback(async () => {
  // ...
}, [conversationHistory]);
```

Use it when passing a function to child components or effects and you want a stable function reference.

Examples:

- Submit handler
- Keyboard event handler
- Callback passed into child components
- Function used as a dependency in `useEffect`

Mental model:

```text
useCallback = remember function
```

## Short Comparison

```text
useState    = remember value, update UI when changed
useRef      = remember value, do not update UI when changed
useEffect   = run side effect after render
useCallback = remember function
```
