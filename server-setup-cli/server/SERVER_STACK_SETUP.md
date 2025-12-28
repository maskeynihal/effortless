# Server Stack Setup Step

Automated installation of complete LAMP/LEMP stack for Laravel applications with version-specific PHP and database support.

## Overview

This step automates the installation and configuration of:

- **PHP** (with version selection: 8.3, 8.2, 8.1, 8.0, 7.4)
- **Nginx** web server
- **Database** (MySQL or PostgreSQL)
- **Composer** (latest version)
- **PHP-FPM** (configured and running)
- **All Laravel-required PHP extensions**

## Usage

### CLI

```bash
cd server
npm run cli
```

Select **"Setup server stack (PHP/Nginx/Database)"** from the menu.

You'll be prompted for:

1. **PHP Version** - Choose from 8.3 (latest), 8.2, 8.1, 8.0, or 7.4
2. **Database Server** - MySQL or PostgreSQL

### API

```bash
POST http://localhost:3000/api/step/server-stack-setup
Content-Type: application/json

{
  "host": "your-server.com",
  "username": "deploy",
  "applicationName": "my-laravel-app",
  "phpVersion": "8.3",
  "database": "mysql"
}
```

## What Gets Installed

### PHP Extensions (All Versions)

- **Core**: cli, fpm, mbstring, xml, bcmath, curl, zip, gd, intl, soap, opcache, readline, common
- **MySQL**: mysql, mysqli (when database = "mysql")
- **PostgreSQL**: pgsql (when database = "pgsql")
- **Additional**: redis, imagick

### System Packages

- Nginx (latest stable from distribution)
- MySQL Server 8.0+ OR PostgreSQL (latest from distribution)
- Composer (latest version from getcomposer.org)
- Required build tools and dependencies

## Installation Process

1. **Repository Setup**

   - Ubuntu/Debian: Adds `ondrej/php` PPA for specific PHP versions
   - RHEL/Rocky/CentOS: Enables EPEL and Remi repositories

2. **Package Installation** (in order)

   - Nginx web server
   - Database server (MySQL or PostgreSQL)
   - PHP with all specified extensions
   - Composer

3. **Service Configuration**

   - Enables and starts Nginx
   - Enables and starts database server
   - Enables and starts PHP-FPM
   - Verifies all services are running

4. **Version Verification**
   - Captures installed versions of all components
   - Returns version information in response

## Platform Support

### Supported Operating Systems

- **Ubuntu**: 20.04, 22.04, 24.04
- **Debian**: 11, 12
- **Rocky Linux**: 8, 9
- **CentOS**: 7, 8
- **AlmaLinux**: 8, 9
- **Fedora**: 38+

### Package Managers

- **apt** (Ubuntu/Debian)
- **dnf** (Rocky/Fedora/RHEL 8+)
- **yum** (CentOS 7)

## Prerequisites

- SSH access to target server
- `sudo -n` (passwordless sudo) configured for:
  - Package management commands
  - Service management (systemctl)
- Internet connectivity on target server
- Minimum 1GB RAM, 10GB disk space

## Configuration Notes

### PHP-FPM Socket

- Default: `/var/run/php/php{version}-fpm.sock`
- Backup: `/var/run/php/php-fpm.sock`

### Database Access

- **MySQL**: Root access via `sudo mysql`
- **PostgreSQL**: Default postgres user with peer auth

### Nginx Configuration

- Default config: `/etc/nginx/nginx.conf`
- Sites available: `/etc/nginx/sites-available/`
- Sites enabled: `/etc/nginx/sites-enabled/`

## Time Requirements

- **Typical installation**: 5-8 minutes
- **Timeout**: 5 minutes per package operation
- **Total step timeout**: 30 minutes (fail-safe)

## Post-Installation

After this step completes, you can:

1. Create databases with the **"Create database"** step
2. Setup application folders with **"Setup application folder"**
3. Configure Nginx/HTTPS with **"Setup HTTPS + Nginx"**
4. Deploy your Laravel application

## Troubleshooting

### Common Issues

**Error: sudo -n not permitted**

- Configure passwordless sudo in `/etc/sudoers`:
  ```
  deploy ALL=(ALL) NOPASSWD: ALL
  ```

**Error: Package not found**

- Ensure proper repositories are enabled
- Check internet connectivity
- Try running `sudo apt-get update` (or `sudo dnf check-update`) manually

**Error: Port already in use**

- Another web server may be running (Apache)
- Stop conflicting services: `sudo systemctl stop apache2`

**PHP version not available**

- Ondrej PPA supports PHP 7.4-8.3
- For older versions, manual repository configuration needed

## Example Response

```json
{
  "success": true,
  "message": "Server stack installed successfully",
  "data": {
    "phpVersion": "8.3",
    "database": "mysql",
    "extensionsInstalled": 18,
    "installLog": [
      "Added ondrej/php PPA",
      "Installed Nginx",
      "Installed MySQL server",
      "Installed PHP 8.3 with 18 extensions",
      "Installed Composer",
      "Configured and started PHP-FPM",
      "Started Nginx"
    ],
    "versions": {
      "php": "PHP 8.3.0 (cli) (built: Nov 23 2023 10:43:22) (NTS)",
      "composer": "Composer version 2.6.5 2023-10-06 10:09:09",
      "nginx": "nginx version: nginx/1.24.0 (Ubuntu)",
      "database": "mysql  Ver 8.0.35-0ubuntu0.22.04.1 for Linux on x86_64 ((Ubuntu))"
    }
  }
}
```

## Security Considerations

- All package installations use official repositories
- Composer installed from official getcomposer.org
- PHP-FPM runs as www-data user (Ubuntu/Debian)
- Database servers installed with default security settings
- Recommend running `mysql_secure_installation` after setup

## Next Steps

1. **Secure MySQL** (if installed):

   ```bash
   sudo mysql_secure_installation
   ```

2. **Configure PHP settings** (if needed):

   ```bash
   sudo nano /etc/php/8.3/fpm/php.ini
   sudo systemctl restart php8.3-fpm
   ```

3. **Setup application** using other CLI steps:
   - Create database
   - Setup folder structure
   - Configure environment (.env)
   - Setup HTTPS with Certbot

## Integration with Other Steps

This step is typically run **first** in the deployment workflow:

```
1. Setup server stack (PHP/Nginx/Database) ← You are here
2. Generate & register deploy key
3. Setup application folder
4. Setup environment (.env)
5. Create database
6. Setup HTTPS + Nginx
7. Setup SSH key for GitHub Actions
8. Create GitHub Actions workflow
```
