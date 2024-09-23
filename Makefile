HOSTS ?= servers

list:
	ansible-inventory -i inventory.ini --list

ping:
	ansible $(HOSTS) -m ping -i inventory.ini

check:
	ansible-playbook -i inventory.ini site.yml --ask-become-pass --check

playbook:
	ansible-playbook -i inventory.ini site.yml --ask-become-pass

playbook-no-ask-become-pass:
	ansible-playbook -i inventory.ini site.yml

playbook-test:
	ansible-playbook -i inventory.ini site.yml \
	-e "domain=example.com" \
	-e "php_version=8.2" \
	-e "git_repository=git@github.com:laravel/laravel.git" \
	-e "git_branch=master" \
	-e "vault_url=http://localhost:8200/v1/secret/data/secret" \
	-e "vault_access_token=root"
