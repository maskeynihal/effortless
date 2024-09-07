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
