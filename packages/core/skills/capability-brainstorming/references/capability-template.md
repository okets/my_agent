# CAPABILITY.md Template

```yaml
---
name: <Human-readable name>
provides: <well-known type or omit for custom>
interface: script
requires:
  env:
    - <API_KEY_NAME>
---

<Description of what this capability does.>

## <script-name>

- **Input:** `scripts/<script>.sh <arg1> [arg2]`
- **Output:** JSON `{ "key": "value" }`

<Additional usage notes, error cases, limitations.>
```

## config.yaml Template

```yaml
# Non-secret configuration
model: <model-name>
voice_id: <voice-identifier>
output_format: ogg
language: en
```

Scripts read this file via relative path: `$SCRIPT_DIR/../config.yaml`
