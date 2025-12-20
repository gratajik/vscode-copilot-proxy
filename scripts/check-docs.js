#!/usr/bin/env node

/**
 * Documentation Validation Script
 *
 * Validates the documentation structure and consistency:
 * - Each feature folder has design.md and TASKS.md
 * - Status markers are consistent
 * - Task markers follow format ([ ], [x], [>])
 * - No stale "Not Started" on implemented features
 *
 * @see docs/features/knowledge-management/design.md
 */

const fs = require('fs');
const path = require('path');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const FEATURES_DIR = path.join(DOCS_DIR, 'features');

// ANSI color codes
const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

function log(color, symbol, message) {
    console.log(`${colors[color]}${symbol}${colors.reset} ${message}`);
}

function error(message) {
    log('red', '[ERROR]', message);
}

function warn(message) {
    log('yellow', '[WARN]', message);
}

function success(message) {
    log('green', '[OK]', message);
}

function info(message) {
    log('blue', '[INFO]', message);
}

/**
 * Check if a feature folder has required files
 */
function checkFeatureFolder(featureName) {
    const featurePath = path.join(FEATURES_DIR, featureName);
    const issues = [];

    // Check for design.md
    const designPath = path.join(featurePath, 'design.md');
    if (!fs.existsSync(designPath)) {
        issues.push(`Missing design.md`);
    }

    // Check for TASKS.md
    const tasksPath = path.join(featurePath, 'TASKS.md');
    if (!fs.existsSync(tasksPath)) {
        issues.push(`Missing TASKS.md`);
    } else {
        // Validate TASKS.md content
        const tasksContent = fs.readFileSync(tasksPath, 'utf8');
        const tasksIssues = validateTasksFile(tasksContent, featureName);
        issues.push(...tasksIssues);
    }

    return issues;
}

/**
 * Validate TASKS.md content
 */
function validateTasksFile(content, featureName) {
    const issues = [];
    const lines = content.split('\n');

    // Check for valid task markers
    const taskLineRegex = /^-\s+\[([ x>~])\]/;
    let hasCompletedTasks = false;
    let hasNotStartedStatus = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // Check for invalid task markers
        const taskMatch = line.match(/^-\s+\[([^\]]*)\]/);
        if (taskMatch) {
            const marker = taskMatch[1];
            if (![' ', 'x', '>', '~'].includes(marker)) {
                issues.push(`Line ${lineNum}: Invalid task marker [${marker}] - use [ ], [x], [>], or [~]`);
            }
            if (marker === 'x') {
                hasCompletedTasks = true;
            }
        }

        // Check for "Not Started" status
        if (line.includes('**Status:** Not Started')) {
            hasNotStartedStatus = true;
        }
    }

    // Warn if has completed tasks but still shows "Not Started"
    if (hasCompletedTasks && hasNotStartedStatus) {
        issues.push(`Status shows "Not Started" but has completed tasks - update status`);
    }

    // Check for timestamps on completed tasks
    const completedTaskLines = content.match(/-\s+\[x\].*$/gm) || [];
    for (const taskLine of completedTaskLines) {
        // Simple check - just warn if no date-like pattern nearby
        // This is intentionally lenient
    }

    return issues;
}

/**
 * Check FEATURE_INVENTORY.md exists and is valid
 */
function checkFeatureInventory() {
    const inventoryPath = path.join(DOCS_DIR, 'FEATURE_INVENTORY.md');
    const issues = [];

    if (!fs.existsSync(inventoryPath)) {
        issues.push('FEATURE_INVENTORY.md is missing');
        return issues;
    }

    const content = fs.readFileSync(inventoryPath, 'utf8');

    // Check for required sections
    const requiredSections = [
        'Feature Status Legend',
        'Core Features',
        'Maintenance'
    ];

    for (const section of requiredSections) {
        if (!content.includes(section)) {
            issues.push(`FEATURE_INVENTORY.md missing section: ${section}`);
        }
    }

    return issues;
}

/**
 * Main validation function
 */
function main() {
    console.log('\n=== Documentation Validation ===\n');

    let totalIssues = 0;
    let totalWarnings = 0;

    // Check FEATURE_INVENTORY.md
    info('Checking FEATURE_INVENTORY.md...');
    const inventoryIssues = checkFeatureInventory();
    if (inventoryIssues.length === 0) {
        success('FEATURE_INVENTORY.md is valid');
    } else {
        for (const issue of inventoryIssues) {
            error(`FEATURE_INVENTORY.md: ${issue}`);
            totalIssues++;
        }
    }
    console.log();

    // Check features directory exists
    if (!fs.existsSync(FEATURES_DIR)) {
        error('docs/features/ directory does not exist');
        process.exit(1);
    }

    // Get all feature folders
    const features = fs.readdirSync(FEATURES_DIR)
        .filter(f => fs.statSync(path.join(FEATURES_DIR, f)).isDirectory());

    info(`Found ${features.length} feature(s) to check\n`);

    // Check each feature
    for (const feature of features) {
        console.log(`Checking ${feature}/`);
        const issues = checkFeatureFolder(feature);

        if (issues.length === 0) {
            success(`  All checks passed`);
        } else {
            for (const issue of issues) {
                if (issue.includes('update status') || issue.includes('timestamp')) {
                    warn(`  ${issue}`);
                    totalWarnings++;
                } else {
                    error(`  ${issue}`);
                    totalIssues++;
                }
            }
        }
    }

    // Summary
    console.log('\n=== Summary ===\n');
    console.log(`Features checked: ${features.length}`);
    console.log(`Errors: ${totalIssues}`);
    console.log(`Warnings: ${totalWarnings}`);

    if (totalIssues > 0) {
        console.log(`\n${colors.red}Documentation validation failed${colors.reset}`);
        process.exit(1);
    } else if (totalWarnings > 0) {
        console.log(`\n${colors.yellow}Documentation validation passed with warnings${colors.reset}`);
        process.exit(0);
    } else {
        console.log(`\n${colors.green}Documentation validation passed${colors.reset}`);
        process.exit(0);
    }
}

main();
