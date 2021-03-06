'use strict';
import * as paths from 'path';
import { commands, Range, TextDocumentShowOptions, TextEditor, Uri, ViewColumn } from 'vscode';
import { BuiltInCommands, GlyphChars } from '../constants';
import { Container } from '../container';
import { GitCommit, GitService, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, command, Commands } from './common';

export interface DiffWithCommandArgsRevision {
    sha: string;
    uri: Uri;
    title?: string;
}

export interface DiffWithCommandArgs {
    lhs?: DiffWithCommandArgsRevision;
    rhs?: DiffWithCommandArgsRevision;
    repoPath?: string;

    line?: number;
    showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithCommand extends ActiveEditorCommand {
    static getMarkdownCommandArgs(args: DiffWithCommandArgs): string;
    static getMarkdownCommandArgs(commit1: GitCommit, commit2: GitCommit): string;
    static getMarkdownCommandArgs(argsOrCommit1: DiffWithCommandArgs | GitCommit, commit2?: GitCommit): string {
        let args: DiffWithCommandArgs | GitCommit;
        if (argsOrCommit1 instanceof GitCommit) {
            const commit1 = argsOrCommit1;

            if (commit2 === undefined) {
                if (commit1.isUncommitted) {
                    args = {
                        repoPath: commit1.repoPath,
                        lhs: {
                            sha: 'HEAD',
                            uri: commit1.uri
                        },
                        rhs: {
                            sha: '',
                            uri: commit1.uri
                        }
                    };
                }
                else {
                    args = {
                        repoPath: commit1.repoPath,
                        lhs: {
                            sha:
                                commit1.previousSha !== undefined
                                    ? commit1.previousSha
                                    : GitService.deletedOrMissingSha,
                            uri: commit1.previousUri!
                        },
                        rhs: {
                            sha: commit1.sha,
                            uri: commit1.uri
                        }
                    };
                }
            }
            else {
                args = {
                    repoPath: commit1.repoPath,
                    lhs: {
                        sha: commit1.sha,
                        uri: commit1.uri
                    },
                    rhs: {
                        sha: commit2.sha,
                        uri: commit2.uri
                    }
                };
            }
        }
        else {
            args = argsOrCommit1;
        }

        return super.getMarkdownCommandArgsCore<DiffWithCommandArgs>(Commands.DiffWith, args);
    }

    constructor() {
        super(Commands.DiffWith);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffWithCommandArgs = {}): Promise<any> {
        args = {
            ...args,
            lhs: { ...args.lhs },
            rhs: { ...args.rhs },
            showOptions: { ...args.showOptions }
        } as DiffWithCommandArgs;
        if (args.repoPath === undefined || args.lhs === undefined || args.rhs === undefined) return undefined;

        try {
            let lhsSha = args.lhs.sha;
            let rhsSha = args.rhs.sha;

            [args.lhs.sha, args.rhs.sha] = await Promise.all([
                await Container.git.resolveReference(args.repoPath, args.lhs.sha, args.lhs.uri),
                await Container.git.resolveReference(args.repoPath, args.rhs.sha, args.rhs.uri)
            ]);

            if (args.lhs.sha !== GitService.deletedOrMissingSha) {
                lhsSha = args.lhs.sha;
            }

            if (args.rhs.sha && args.rhs.sha !== GitService.deletedOrMissingSha) {
                // Ensure that the file still exists in this commit
                const status = await Container.git.getFileStatusForCommit(
                    args.repoPath,
                    args.rhs.uri.fsPath,
                    args.rhs.sha
                );
                if (status !== undefined && status.status === 'D') {
                    args.rhs.sha = GitService.deletedOrMissingSha;
                }
                else {
                    rhsSha = args.rhs.sha;
                }
            }

            const [lhs, rhs] = await Promise.all([
                Container.git.getVersionedUri(args.repoPath, args.lhs.uri.fsPath, args.lhs.sha),
                Container.git.getVersionedUri(args.repoPath, args.rhs.uri.fsPath, args.rhs.sha)
            ]);

            let rhsSuffix = GitService.shortenSha(rhsSha, { uncommitted: 'Working Tree' }) || '';
            if (rhs === undefined) {
                if (GitService.isUncommitted(args.rhs.sha)) {
                    rhsSuffix = 'deleted';
                }
                else if (rhsSuffix.length === 0 && args.rhs.sha === GitService.deletedOrMissingSha) {
                    rhsSuffix = 'not in Working Tree';
                }
                else {
                    rhsSuffix = `deleted in ${rhsSuffix}`;
                }
            }
            else if (lhs === undefined) {
                rhsSuffix = `added in ${rhsSuffix}`;
            }

            let lhsSuffix = args.lhs.sha !== GitService.deletedOrMissingSha ? GitService.shortenSha(lhsSha) || '' : '';
            if (lhs === undefined && args.rhs.sha.length === 0) {
                if (rhs !== undefined) {
                    lhsSuffix = `not in ${lhsSuffix}`;
                    rhsSuffix = '';
                }
                else {
                    lhsSuffix = `deleted in ${lhsSuffix})`;
                }
            }

            if (args.lhs.title === undefined && (lhs !== undefined || lhsSuffix.length !== 0)) {
                args.lhs.title = `${paths.basename(args.lhs.uri.fsPath)}${lhsSuffix ? ` (${lhsSuffix})` : ''}`;
            }
            if (args.rhs.title === undefined) {
                args.rhs.title = `${paths.basename(args.rhs.uri.fsPath)}${rhsSuffix ? ` (${rhsSuffix})` : ''}`;
            }

            const title =
                args.lhs.title !== undefined && args.rhs.title !== undefined
                    ? `${args.lhs.title} ${GlyphChars.ArrowLeftRightLong} ${args.rhs.title}`
                    : args.lhs.title || args.rhs.title;

            if (args.showOptions === undefined) {
                args.showOptions = {};
            }

            if (args.showOptions.viewColumn === undefined) {
                args.showOptions.viewColumn = ViewColumn.Active;
            }

            if (args.line !== undefined && args.line !== 0) {
                args.showOptions.selection = new Range(args.line, 0, args.line, 0);
            }

            return await commands.executeCommand(
                BuiltInCommands.Diff,
                lhs === undefined
                    ? GitUri.toRevisionUri(GitService.deletedOrMissingSha, args.lhs.uri.fsPath, args.repoPath)
                    : lhs,
                rhs === undefined
                    ? GitUri.toRevisionUri(GitService.deletedOrMissingSha, args.rhs.uri.fsPath, args.repoPath)
                    : rhs,
                title,
                args.showOptions
            );
        }
        catch (ex) {
            Logger.error(ex, 'DiffWithCommand', 'getVersionedFile');
            return Messages.showGenericErrorMessage('Unable to open compare');
        }
    }
}
