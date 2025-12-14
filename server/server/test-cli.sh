#!/bin/bash

# Test CLI with automated input
# Adjust these values as needed

HOST="4.186.26.86"
USERNAME="adminuser"
KEY_PATH="$HOME/.ssh/id_rsa"
PORT="22"
PAT="your_github_pat_here"
KEY_NAME="effortless-test"

# Run CLI with input
npm run cli <<EOF
$HOST
$USERNAME
$KEY_PATH
$PORT
$PAT
$KEY_NAME
y
EOF
