# Effortless

### Pre-requisites
- [Install Ansible](https://docs.ansible.com/ansible/latest/installation_guide/intro_installation.html#installing-and-upgrading-ansible)
- [OpenSSH Server](https://ubuntu.com/server/docs/service-openssh)
- [Ubuntu Server](https://ubuntu.com/download/server)
- [SSH Setup](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent)

#### 1. Inventory
- `ansible_connection`
- `ansible_user`
- `ansible_sudo_pass`
- `ansible_ssh_private`

```ini
[servers]
foo.example.com ansible_connection=ssh ansible_user=ubuntu ansible_sudo_pass=ubuntu ansible_ssh_private=~/.ssh/id_ed25519
```

#### 2. Tasks
- [X] Install nginx
- [X] Install PHP 8.1
- [X] Install mariadb
- [X] Setup mariadb database
- [X] Setup mariadb user

#### 3. Usage
- `make list`: Output all hosts info, works as inventory script
- `make ping`: Ping the host group in your inventory.
- `make check`: Don’t make any changes; instead, try to predict some of the changes that may occur
- `make playbook`: Runs Ansible playbooks, executing the defined tasks on the targeted hosts.
- `make playbook-no-ask-become-password`: Same as playbook but without ask for privilege escalation password (use ansible_sudo_pass)
