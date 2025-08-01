#!/bin/bash

# cleanDist.sh
#
# Deletion prompt for the ./dist/ folder.

set -e

tools_dir="$(realpath "$(dirname "${BASH_SOURCE[0]}")")"
dist_dir="$(realpath "$tools_dir/../dist")"
source "$tools_dir/common.sh"

if [[ ! -d $dist_dir ]]; then
  echo "dist directory not found" >&2
  exit 1
fi

if ! yes_or_no --default-no "Delete ${dist_dir}?"; then
  exit 1
fi
rm -rf "$dist_dir"
