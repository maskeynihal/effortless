# Effortless

### Pre-requisites
- [Install Ansible](https://docs.ansible.com/ansible/latest/installation_guide/intro_installation.html#installing-and-upgrading-ansible)
- [OpenSSH Server](https://ubuntu.com/server/docs/service-openssh)
- [Ubuntu Server](https://ubuntu.com/download/server)
- [SSH Setup](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent)
    ```shell
    ssh-copy-id -i ~/.ssh/mykey user@hostname
    ```
- [Vault](https://www.vaultproject.io/)

#### 1. Inventory
- `ansible_connection`
- `ansible_user`
- `ansible_sudo_pass`
- `ansible_ssh_private`

```ini
[servers]
foo.example.com ansible_connection=ssh ansible_user=ubuntu ansible_sudo_pass=ubuntu ansible_ssh_private=~/.ssh/id_ed25519 ansible_ssh_common_args='-o ForwardAgent=yes -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes'
```

#### 2. Tasks
- [X] Install acl
- [X] Install git
- [X] Install certbot
- [X] Install nginx
- [X] Install nvm
- [X] Install node.js
- [X] Install PHP
- [X] Install composer
- [X] Setup .env
- [X] Install mysql|pgsql
- [X] Setup mysql|pgsql database
- [X] Setup mysql|pgsql user
- [X] Setup github repository
- [X] Deploy github repository
- [X] Setup nginx
- [X] Setup SSL

#### 3. Usage
- `make list`: Output all hosts info, works as inventory script
- `make ping`: Ping the host group in your inventory.
- `make check`: Don’t make any changes; instead, try to predict some of the changes that may occur
- `make playbook`: Runs Ansible playbooks, executing the defined tasks on the targeted hosts.
- `make playbook-no-ask-become-password`: Same as playbook but without ask for privilege escalation password (use ansible_sudo_pass)

**Example:**
```shell
ansible-playbook -i inventory.ini site.yml \
-e "domain=<DOMAIN>" \
-e "nvm_version=<NVM_VERSION>" \
-e "node_version=<NODE_VERSION>" \
-e "php_version=<PHP_VERSION>" \
-e "git_branch=<GIT_BRANCH>" \
-e "git_repository=<GIT_REPOSITORY_SSH_URL>" \
-e "vault_url=<VAULT_URL>" \
-e "vault_access_token=<VAULT_TOKEN>"
```

#### 4. Vault Secrets

```json
{
  "APP_DEBUG": true,
  "APP_ENV": "local",
  ...
  "DB_CONNECTION": "mysql",
  "DB_DATABASE": "laravel",
  "DB_HOST": "127.0.0.1",
  "DB_PASSWORD": "admin",
  "DB_PORT": "3306",
  "DB_USERNAME": "admin",
  ...
  "SESSION_DRIVER": "database",
  "SESSION_ENCRYPT": false,
  "SESSION_LIFETIME": "120",
  "SESSION_PATH": "/",
  "VITE_APP_NAME": "${APP_NAME}"
}
```
