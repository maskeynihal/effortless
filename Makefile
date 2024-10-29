HOSTS ?= servers

ssh:
	ssh-add -D
	ansible all -i inventory.ini -m shell -a "ssh -T git@github.com || true"

galaxy:
	ansible-galaxy collection install -r galaxy-requirements.yml

list:
	ansible-inventory -i inventory.ini --list

ping:
	ansible $(HOSTS) -m ping -i inventory.ini

check:
	ansible-playbook -i inventory.ini site.yml --ask-become-pass --check

playbook: galaxy ssh
	ansible-playbook -i inventory.ini site.yml --ask-become-pass

playbook-no-ask-become-pass: galaxy ssh
	ansible-playbook -i inventory.ini site.yml

playbook-test: galaxy ssh
	ansible-playbook -i inventory.ini site.yml \
	-e "domain=example.com" \
	-e "nvm_version=v0.40.0" \
	-e "node_version=v22.10.0" \
	-e "php_version=8.2" \
	-e "git_repository=git@github.com:laravel/laravel.git" \
	-e "git_branch=master" \
	-e "vault_url=http://localhost:8200/v1/secret/data/secret" \
	-e "vault_access_token=root"
