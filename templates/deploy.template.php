<?php

namespace Deployer;

require 'recipe/laravel.php';

// Config

set('repository', '{{ git_repository }}');

add('shared_files', []);
add('shared_dirs', []);
add('writable_dirs', []);

// Hosts
host('localhost')
  ->set('remote_user', '{{ ansible_user }}')
  ->set('deploy_path', '/var/www/{{ domain }}')
  ->set('ssh_arguments', [
    '-o UserKnownHostsFile=/dev/null',
    '-o StrictHostKeyChecking=no'
  ]);

// Hooks
after('deploy:failed', 'deploy:unlock');
