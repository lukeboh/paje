export {};
const globalBucket = globalThis as { __pajeTests?: Promise<void>[] };
globalBucket.__pajeTests = [];

const testFiles = [
  "./git_sync_core_test.js",
  "./git_tree_selection_test.js",
  "./git_parallel_sync_test.js",
  "./git_branch_service_test.js",
  "./git_command_helpers_test.js",
  "./git_command_select_server_test.js",
  "./ssh_config_test.js",
  "./ssh_manager_test.js",
  "./logger_broker_test.js",
  "./ssh_key_store_command_test.js",
  "./git_server_store_manage_test.js",
  "./git_server_store_edit_test.js",
  "./ssh_key_overwrite_test.js",
  "./logger_transports_test.js",
  "./log_store_level_test.js",
  "./screen_host_test.js",
  "./tui_render_test.js",
  "./tui_prompt_chain_test.js",
  "./tui_prompt_form_layout_test.js",
  "./tui_loading_screen_test.js",
  "./tui_stack_overflow_test.js",
  "./tui_menu_dashboard_test.js",
  "./gitlab_web_key_test.js",
  "./git_sync_auth_guard_test.js",
  "./gitlab_personal_token_test.js",
  "./git_sync_tree_render_test.js",
  "./git_sync_summary_test.js",
  "./git_ant_glob_filter_test.js",
  "./env_yaml_write_test.js",
  "./env_yaml_first_run_test.js",
  "./logger_panel_color_test.js",
  "./tui_edit_params_modal_test.js",
  "./git_sync_cache_refresh_test.js",
  "./tui_tree_text_filter_test.js",
  "./tui_no_flicker_test.js",
  "./tui_screen_transition_test.js",
  "./vscode_tree_adapter_test.js",
  "./vscode_extension_smoke_test.js",
];

// One crashing test must not silently skip the rest of the suite: import each
// file in isolation, record failures, and report them all at the end.
const failures: Array<{ file: string; error: unknown }> = [];

for (const file of testFiles) {
  try {
    await import(file);
    await Promise.all(globalBucket.__pajeTests ?? []);
  } catch (error) {
    failures.push({ file, error });
    console.error(`${file.replace("./", "").replace(".js", "")}: FAILED`);
    console.error(error);
  } finally {
    globalBucket.__pajeTests = [];
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} arquivo(s) de teste com falha:`);
  failures.forEach(({ file }) => console.error(`  - ${file}`));
  process.exitCode = 1;
} else {
  console.log("\nTodos os arquivos de teste passaram.");
}
