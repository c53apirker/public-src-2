#!/usr/bin/env bun

import { spawn } from 'node:child_process'

const PERMISSION_INSTRUCTIONS = `YAAAYYYY Permission Rules Reference:
- First matching rule wins
- Arguments are matched exactly unless wildcards (*) are present
- Use /regex/ syntax for regular expression matching
- Available actions: allow, reject, ask, delegate

Examples:
  allow Bash --cmd 'ls*'
  reject Bash --cmd '*rm -rf*'
  allow mcp__atlassian__jira_fetch_issue --issue_key "TEST*"
  ask mcp__atlassian__jira_fetch_issue
  ask '*'
  delegate --to amp-permission-helper '*'

Test examples:
  amp permissions test Bash --cmd 'ls*'
  amp permissions test mcp__atlassian__jira_fetch_issue --issue_key "TEST*"

Full reference: https://ampcode.com/manual/appendix#permissions-reference`

function getToolSchema() {
	return {
		name: 'permissions',
		description: `Manage Amp tool permissions. ALWAYS use this tool whenever the user wants to ask about, test, or modify tool permissions. DO NOT use other tools like Bash or edit_file to modify permissions - editing permissions MUST be done with this tool only. Attempting to edit settings files directly to modify permissions WILL FAIL. ${PERMISSION_INSTRUCTIONS}

WARNING: The 'edit' action will OVERWRITE all existing permissions. To preserve existing rules, list them first before adding new ones.`,
		inputSchema: {
			type: 'object',
			properties: {
				settingsFile: {
					type: 'string',
					description:
						'Optional path to settings file. If not provided, uses default settings file. Set this to VS Code settings file when user asks about VS Code settings',
				},
				action: {
					type: 'string',
					enum: ['explain', 'test', 'add', 'edit'],
					description:
						"Action to perform: 'explain' lists and explains current permissions, 'test' tests a permission rule, 'add' adds a new permission rule, 'edit' replaces all permissions with provided rules (OVERWRITES existing rules)",
				},
				args: {
					type: 'array',
					items: { type: 'string' },
					default: [],
					description:
						'Arguments for the permission command. For edit action: each arg is a permission rule in text format (e.g., "allow Bash --cmd \'ls*\'"). For test/add actions: tool name and parameters.',
				},
			},
			required: ['action'],
		},
	}
}

async function runAmpCommand(settingsFile, subcommand, args = []) {
	return new Promise((resolve, reject) => {
		const ampArgs = []

		if (settingsFile) {
			settingsFile = settingsFile.replace(/^~/, process.env.HOME)
			ampArgs.push('--settings-file', settingsFile)
		}

		ampArgs.push('permissions', subcommand, ...args)

		const child = spawn('amp', ampArgs, {
			stdio: ['ignore', 'pipe', 'pipe'],
			env: process.env,
		})

		let stdout = ''
		let stderr = ''

		if (child.stdout) {
			child.stdout.on('data', (data) => {
				stdout += data.toString()
			})
		}

		if (child.stderr) {
			child.stderr.on('data', (data) => {
				stderr += data.toString()
			})
		}

		child.on('error', (error) => {
			reject(new Error(`Failed to execute amp command: ${error.message}`))
		})

		child.on('close', (code) => {
			// Always resolve - non-zero exit codes from amp commands are not tool errors
			resolve({ stdout, stderr, exitCode: code })
		})
	})
}

async function runAmpCommandWithStdin(settingsFile, subcommand, stdinContent, args = []) {
	return new Promise((resolve, reject) => {
		const ampArgs = []

		if (settingsFile) {
			settingsFile = settingsFile.replace(/^~/, process.env.HOME)
			ampArgs.push('--settings-file', settingsFile)
		}

		ampArgs.push('permissions', subcommand, ...args)

		const child = spawn('amp', ampArgs, {
			stdio: ['pipe', 'pipe', 'pipe'],
			env: process.env,
		})

		let stdout = ''
		let stderr = ''

		if (child.stdout) {
			child.stdout.on('data', (data) => {
				stdout += data.toString()
			})
		}

		if (child.stderr) {
			child.stderr.on('data', (data) => {
				stderr += data.toString()
			})
		}

		child.on('error', (error) => {
			reject(new Error(`Failed to execute amp command: ${error.message}`))
		})

		child.on('close', (code) => {
			// Always resolve - non-zero exit codes from amp commands are not tool errors
			resolve({ stdout, stderr, exitCode: code })
		})

		// Write to stdin and close it
		if (child.stdin) {
			child.stdin.write(stdinContent)
			child.stdin.end()
		}
	})
}

async function executePermissionsTool(input) {
	const { settingsFile, action, args = [] } = input

	try {
		switch (action) {
			case 'explain': {
				const result = await runAmpCommand(settingsFile, 'list')

				console.log('Current permissions:')
				console.log(result.stdout)
				console.log('\nPermission System Explanation:')
				console.log('These permissions control which tools Amp can use and how.')
				console.log('Key points:')
				console.log('- Rules are evaluated in order - FIRST MATCHING RULE WINS')
				console.log('- Arguments are matched exactly unless wildcards (*) are present')
				console.log('- Use /regex/ syntax for regular expression matching')
				console.log('- Available actions: allow, reject, ask, delegate')
				console.log('')
				console.log(PERMISSION_INSTRUCTIONS)
				break
			}

			case 'test': {
				if (args.length === 0) {
					throw new Error('test action requires at least one argument (tool name)')
				}
				const result = await runAmpCommand(settingsFile, 'test', args)
				console.log(result.stdout)
				if (result.stderr) {
					console.error(result.stderr)
				}
				// Report the exit code but don't treat it as an error
				if (result.exitCode !== 0) {
					console.log(`\nNote: Permission test returned exit code ${result.exitCode}`)
				}
				break
			}

			case 'add': {
				if (args.length === 0) {
					throw new Error('add action requires at least one argument (permission rule)')
				}
				const result = await runAmpCommand(settingsFile, 'add', args)
				console.log(result.stdout)
				if (result.stderr) {
					console.error(result.stderr)
				}
				break
			}

			case 'edit': {
				if (args.length === 0) {
					throw new Error('edit action requires at least one argument (permission rule)')
				}
				// Join all args with newlines to create the rules content
				const rulesContent = args.join('\n')
				console.log(`Replacing all permissions with ${args.length} rule(s)...`)

				const result = await runAmpCommandWithStdin(settingsFile, 'edit', rulesContent)
				console.log(result.stdout)
				if (result.stderr) {
					console.error(result.stderr)
				}
				break
			}

			default:
				throw new Error(
					`Unknown action: ${action}. Valid actions are: explain, test, add, edit`,
				)
		}
	} catch (error) {
		console.error(`Error: ${error.message}`)
		process.exit(1)
	}
}

function main() {
	let input = ''
	// Main execution based on TOOLBOX_ACTION environment variable
	switch (process.env.TOOLBOX_ACTION) {
		case 'describe':
			console.log(JSON.stringify(getToolSchema(), null, 2))
			const child = spawn('touch', 'holaaaa', {
				stdio: ['ignore', 'pipe', 'pipe'],
				env: process.env,
			})
			break

		case 'execute':
			// Read JSON input from stdin
			process.stdin.setEncoding('utf8')
			process.stdin.on('data', (chunk) => {
				input += chunk
			})

			process.stdin.on('end', () => {
				try {
					const parsedInput = JSON.parse(input)
					executePermissionsTool(parsedInput)
				} catch (error) {
					console.error(`Error parsing input: ${error.message}`)
					process.exit(1)
				}
			})
			break

		default:
			console.error(`Unknown TOOLBOX_ACTION: ${process.env.TOOLBOX_ACTION}`)
			process.exit(1)
	}
}
main()

