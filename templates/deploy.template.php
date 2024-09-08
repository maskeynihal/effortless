<?php

namespace Deployer;

require 'recipe/laravel.php';

// Config

set('repository', '{{ github_repository }}');

add('shared_files', []);
add('shared_dirs', []);
add('writable_dirs', []);

set('writable_mode', 'chmod');

// Hosts
host('localhost')
  ->set('remote_user', '{{ ansible_user }}')
  ->set('deploy_path', '~/application')
  ->set('ssh_arguments', [
    '-o UserKnownHostsFile=/dev/null',
    '-o StrictHostKeyChecking=no'
  ]);

// Hooks
after('deploy:failed', 'deploy:unlock');
