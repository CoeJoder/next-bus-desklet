#!/bin/bash

# common.sh
#
# Common functions and constants used by other scripts.

# yes-or-no prompt
# 'no' is always falsey (returns 1)
function yes_or_no() {
	local confirm
	if [[ $# -ne 2 || ($1 != '--default-yes' && $1 != '--default-no') ]]; then
		printerr 'usage: yes_or_no {--default-yes|--default-no} prompt'
		exit 2
	fi
	if [[ $1 == '--default-yes' ]]; then
		IFS= read -rp "$2 (Y/n): " confirm
		if [[ $confirm == [nN] || $confirm == [nN][oO] ]]; then
			return 1
		fi
	else
		IFS= read -rp "$2 (y/N): " confirm
		if [[ $confirm != [yY] && $confirm != [yY][eE][sS] ]]; then
			return 1
		fi
	fi
}
