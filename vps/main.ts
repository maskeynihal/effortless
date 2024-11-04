import * as path from "jsr:@std/path";
import sodium from "npm:libsodium-wrappers";

await sodium.ready;

const HOME_DIR = Deno.env.get("HOME") || "~/"

const SSH_KEY_TITLE = "Effortless Github Deploy Key"
const SSH_KEY_NAME = "effortless"
const SSH_KEY_PATH = path.join(HOME_DIR, ".ssh", SSH_KEY_NAME)
const SSH_AUTHORIZED_KEYS = path.join(HOME_DIR, ".ssh", "authorized_keys")

// ====================================================================================================
console.log(`Generating public/private ed25519 key pair.`)
console.log(SSH_KEY_PATH)
console.log(`${SSH_KEY_PATH}.pub\n`)

const command = new Deno.Command("ssh-keygen", { args: ["-t", "ed25519", "-q", "-N", "", "-f", SSH_KEY_PATH] });

await command.output();

const SSH_PRIVATE_KEY = await Deno.readTextFile(SSH_KEY_PATH)
const SSH_PUBLIC_KEY = await Deno.readTextFile(`${SSH_KEY_PATH}.pub`)

// ====================================================================================================
console.log(`Adding ${SSH_KEY_PATH}.pub to ${SSH_AUTHORIZED_KEYS}\n`)

await Deno.writeTextFile(SSH_AUTHORIZED_KEYS, SSH_PUBLIC_KEY, { append: true, create: true, mode: 0o600 });

const GITHUB_TOKEN = prompt("GITHUB_TOKEN:", "")
const GITHUB_REPO_OWNER = prompt("GITHUB_REPO_OWNER:", "")
const GITHUB_REPO_NAME = prompt("GITHUB_REPO_NAME:", "")

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  "X-GitHub-Api-Version": "2022-11-28"
}

// ====================================================================================================
console.log(`\nAdding ${SSH_KEY_TITLE} to ${GITHUB_REPO_NAME}`)
console.log(`Validate at https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/settings/keys\n`)

await fetch(`https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/keys`, {
  method: 'POST',
  body: JSON.stringify({
    "title": SSH_KEY_TITLE,
    "key": SSH_PUBLIC_KEY,
    "read_only": true
  }),
  headers
})

// ====================================================================================================
const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/actions/secrets/public-key`, { headers })
const { key, key_id } = await response.json();

const PUBLIC_KEY = key

const binaryKey = sodium.from_base64(PUBLIC_KEY, sodium.base64_variants.ORIGINAL)
const binarySecret = sodium.from_string(SSH_PRIVATE_KEY)
const encryptedBytes = sodium.crypto_box_seal(binarySecret, binaryKey)
const encrypted_value = sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL)

// ====================================================================================================
console.log(`Adding EFFORTLESS_SSH_PRIVATE_KEY to ${GITHUB_REPO_NAME} action secrets`)
console.log(`Validate at https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/settings/secrets/actions`)

await fetch(`https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/actions/secrets/EFFORTLESS_SSH_PRIVATE_KEY`, {
  method: 'PUT',
  body: JSON.stringify({
    key_id: key_id,
    encrypted_value: encrypted_value
  }),
  headers
})
