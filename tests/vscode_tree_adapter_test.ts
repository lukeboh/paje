import assert from "node:assert/strict";
import { describeTreeNode, STATE_PRESENTATION } from "../vscode-extension/src/treeAdapter.js";
import type { GitLabTreeNode, RepoSyncState } from "../src/modules/git/types.js";

// Funcionalidade coberta: adaptador puro da extensão VSCode — mapeia
// GitLabTreeNode para descritores de TreeItem sem depender do módulo
// "vscode", mantendo a lógica testável na suíte principal.

const project: GitLabTreeNode = {
  id: "project-1",
  type: "project",
  label: "repo-a",
  selected: true,
  localPath: "/repos/grupo/repo-a",
  status: { branch: "main", state: "AHEAD", delta: "+2" },
  project: {
    id: 1,
    name: "repo-a",
    path_with_namespace: "grupo/repo-a",
    ssh_url_to_repo: "git@git.exemplo.com:grupo/repo-a.git",
    http_url_to_repo: "https://git.exemplo.com/grupo/repo-a.git",
    pajeServerName: "Exemplo",
  },
};

const group: GitLabTreeNode = {
  id: "group-1",
  type: "group",
  label: "grupo",
  selected: false,
  partiallySelected: true,
  children: [project, { id: "project-2", type: "project", label: "repo-b", selected: false }],
};

// Projeto: status, seleção, tooltip e ícone por estado
const projectDescriptor = describeTreeNode(project);
assert.equal(projectDescriptor.isProject, true);
assert.equal(projectDescriptor.checked, true, "Projeto selecionado deve iniciar marcado");
assert.equal(projectDescriptor.hasChildren, false);
assert.ok(
  projectDescriptor.description.includes("main") && projectDescriptor.description.includes("ahead +2"),
  "Descrição deve trazer branch e estado com delta"
);
assert.ok(projectDescriptor.tooltip.includes("grupo/repo-a"), "Tooltip deve trazer o caminho completo");
assert.ok(projectDescriptor.tooltip.includes("Exemplo"), "Tooltip deve trazer o servidor de origem");
assert.equal(projectDescriptor.localPath, "/repos/grupo/repo-a");
assert.equal(projectDescriptor.iconId, "arrow-up", "AHEAD deve usar o ícone de seta para cima");
assert.equal(projectDescriptor.iconColorId, "charts.blue");
assert.equal(projectDescriptor.contextValue, "pajeProject");

// Grupo: colapsável, contagem de projetos, sem estado
const groupDescriptor = describeTreeNode(group);
assert.equal(groupDescriptor.isProject, false);
assert.equal(groupDescriptor.hasChildren, true);
assert.equal(groupDescriptor.description, "2", "Grupo deve exibir a contagem de projetos descendentes");
assert.equal(groupDescriptor.contextValue, "pajeGroup");
assert.equal(groupDescriptor.checked, false, "Seleção parcial não marca o checkbox do grupo");

// Projeto sem status (ainda não calculado) não pode quebrar
const bare = describeTreeNode({ id: "project-3", type: "project", label: "novo", selected: false });
assert.equal(bare.description, "");
assert.equal(bare.iconId, "repo");

// Todos os estados possuem apresentação definida
const states: RepoSyncState[] = [
  "SYNCED",
  "BEHIND",
  "AHEAD",
  "DIVERGED",
  "REMOTE",
  "EMPTY",
  "LOCAL",
  "UNCOMMITTED",
];
states.forEach((state) => {
  assert.ok(STATE_PRESENTATION[state]?.iconId, `Estado ${state} deve ter ícone`);
  assert.ok(STATE_PRESENTATION[state]?.iconColorId, `Estado ${state} deve ter cor`);
});

console.log("vscode_tree_adapter_test: OK");
