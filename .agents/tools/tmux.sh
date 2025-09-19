#!/usr/bin/env zsh

description() {
  cat <<'EOF'
This tool allows you to run commands in the background and follow their output,
using tmux under the hood.

Every time you run an interactive or long-running process, you MUST use this tool.

This includes:

- common development servers (pnpm dev, npm start, npm dev, etc)
- test watchers (npm run test --watch, vitest --watch)
EOF
}

inputSchema() {
  local describe_action='
  The tmux action to perform:
  info shows all information necessary for connecting to the running tmux instance,
  list-windows will list all windows in the active session,
  capture-output will return the output for a given window,
  run-shell opens a new window with the given command,
  run-raw-commands executes raw tmux commands
  '
  export describe_action
  jq -n '{
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list-windows", "run-shell", "capture-output", "send-keys", "run-raw-commands", "info"],
        description: env.describe_action
      },
      args: { type: "array", items: { type: "string" }, description: "command arguments to pass to the action" },
      target: {type: "string", description: "A tmux target string of the format session_name:window_number.pane_number, e.g. amp:1.2" }
    },
    required: ["action"]
  }'
}

schema() {
  jq -n --argjson inputSchema "$(inputSchema)" --arg desc "$(description)" '{
    name: "tmux",
    description: $desc,
    inputSchema: $inputSchema
  }'
}

run_tmux_command() {
  local action="$1"
  shift
  local args=("$@")

  # Extract session name from current working directory
  local session_name="${PWD##*/}"
  local tmux_cmd=(tmux -f /dev/null -L amp)

  # Ensure session exists
  if ! "${tmux_cmd[@]}" has-session -t "$session_name" 2>/dev/null; then
    "${tmux_cmd[@]}" new-session -d -s "$session_name" -c "$PWD"
  fi

  case "$action" in
    info)
      printf "Server socket: amp\n"
      printf "Connect with: tmux -L amp\n"
      "${tmux_cmd[@]}" list-sessions
      ;;

    list-windows)
      "${tmux_cmd[@]}" list-windows -t "$session_name" -F "#{window_index}: #{window_name}"
      ;;

    run-shell)
      local command="$1"
      # Create new window and run command interactively
      local window_id=$("${tmux_cmd[@]}" new-window -t "$session_name" -c "$PWD" -P -F "#{window_index}")
      "${tmux_cmd[@]}" send-keys -t "$session_name:$window_id" "$command" Enter
      printf "Started command in window %s\n" "$window_id"
      ;;

    capture-output)
      local target="${1:-$session_name}"
      "${tmux_cmd[@]}" capture-pane -t "$target" -p
      ;;

    send-keys)
      local target="$1"
      shift
      for key in "$@"; do
        "${tmux_cmd[@]}" send-keys -t "$target" "$key"
        sleep 0.1
      done
      ;;

    run-raw-commands)
      # Execute raw tmux commands
      "${tmux_cmd[@]}" "${args[@]}"
      ;;

    *)
      printf 'Unknown action: %s\n' "$action" >&2
      return 1
      ;;
  esac
}

main() {
  case "$TOOLBOX_ACTION" in
    describe) schema ;;
    execute)
      # Parse JSON input from stdin
      local input=$(cat)
      local action=$(jq -r '.action' <<< "$input")
      local target=$(jq -r '.target // empty' <<< "$input")
      
      # Extract args array using jq shell quoting
      local args=()
      eval "args=($(jq -r '.args | @sh // empty' <<< "$input"))"

      # Add target as first arg if provided and action needs it
      case "$action" in
        capture-output|send-keys)
          if [[ -n "$target" ]]; then
            run_tmux_command "$action" "$target" "${args[@]}"
          else
            run_tmux_command "$action" "${args[@]}"
          fi
          ;;
        *)
          run_tmux_command "$action" "${args[@]}"
          ;;
      esac
      ;;
    *)
      printf 'Set TOOLBOX_ACTION to describe or execute, then run again\n' >&2
      return 1
      ;;
  esac
}

main "$@"

