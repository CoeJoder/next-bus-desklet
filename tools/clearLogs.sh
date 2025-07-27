#!/bin/bash

# clearLogs.sh
#
# Deletion prompt for all log files in the './log' directory.

set -e
shopt -s nullglob

tools_dir="$(realpath "$(dirname "${BASH_SOURCE[0]}")")"
logs_dir="$tools_dir/../logs"
source "$tools_dir/common.sh"

if [[ ! -d $logs_dir ]]; then
  echo "log directory not found" >&2
  exit 1
fi

log_files=("$logs_dir"/log-*)
if ((${#log_files} > 0)); then
  if ! yes_or_no --default-no "Delete ${#log_files[@]} log file$( ((${#log_files[@]} != 1)) && printf '%s' 's' )?"; then
    exit 1
  fi
  rm -f "${log_files[@]}"
fi
