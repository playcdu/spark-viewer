const MAPPING_DATA_URL = "https://sparkmappings.lucko.me/";

let activeData;
let mappingsInfo;

const $stack = $("#stack");
const $overlay = $("#overlay");
const $loading = $("#loading");
const $sampler = $("#sampler");

/**
 * Called by the application to initialise the sampler view.
 *
 * @param data the json data to be viewed.
 */
function loadSampleData(data) {
    renderData(data, simpleRender);

    // store so we can re-use later, if remapping is applied, for example.
    activeData = data;

    // load mappings data info
    $.getJSON(MAPPING_DATA_URL + "mappings.json", function(mappings) {
        mappingsInfo = mappings["types"];
        $("#mappings-selector").html(renderMappingsSelector(mappingsInfo)).show();

        // listen for mapping selections
        $("#mappings-selector > select").change(function(e) {
            applyRemapping(this.value);
        });
    });
}

/**
 * Main function to load "sampler" data.
 *
 * @param data the json data to be viewed.
 * @param renderingFunction the function to be used to represent sampler entries.
 *        a rendering function can be described as:
 *        (JS Object rep. of node, JSObject rep. of the parentNode, nullable) --> HTML representation of "node" as a string.
 */
function renderData(data, renderingFunction) {
    let html;
    if (!data["threads"] || !data["threads"].length) {
        html = '<p class="no-results">There are no results. (Thread filter does not match thread?)</p>';
    } else {
        html = "";
        for (const thread of data["threads"]) {
            const threadNode = thread["rootNode"] || thread;
            html += renderStackToHtml(threadNode, threadNode["time"], renderingFunction);
            html += '\n';
        }
    }

    $stack.html(html);
    $loading.hide();
    $sampler.show();
}

/**
 * Function to render the sampled data to html.
 *
 * @param root the root of the sample stack
 * @param totalTime the total time taken by all nodes
 * @param renderingFunction the function used for rendering nodes
 * @returns {string} the html
 */
function renderStackToHtml(root, totalTime, renderingFunction) {
    let html = "";

    // init a new stack, and push the root element
    let stack = [{
        node: root,
        parentNode: null,
        status: "start"
    }];

    // perform a iterative traversal of the call stack
    while (stack.length !== 0) {
        const element = stack.pop();
        const status = element.status;

        if (status === "start") {
            const node = element.node;
            const parentNode = element.parentNode;

            // push a marker to "end" this node
            stack.push({
                status: "end"
            });

            // push this nodes children in reverse
            if (node["children"]) {
                for (const child of node.children.slice().reverse()) {
                    stack.push({
                        node: child,
                        parentNode: node,
                        status: "start"
                    });
                }
            }

            // print start
            const timePercent = ((node["time"] / totalTime) * 100).toFixed(2) + "%";
            html += '<li>';
            html += '<div class="node collapsed" data-name="' + simpleRender(node, parentNode) + '">';
            html += '<div class="name">';
            html += renderingFunction(node, parentNode);
            const parentLineNumber = node["parentLineNumber"];
            if (parentLineNumber) {
                html += '<span class="lineNumber" title="Invoked on line ' + parentLineNumber + ' of ' + parentNode["methodName"] + '()">:' + parentLineNumber + '</span>';
            }
            html += '<span class="percent">' + timePercent + '</span>';
            html += '<span class="time">' + node["time"] + 'ms</span>';
            html += '<span class="bar"><span class="bar-inner" style="width: ' + timePercent + '"></span></span>';
            html += '</div>';
            html += '<ul class="children">';
        } else {
            // print end
            html += '</ul>';
            html += '</div>';
            html += '</li>';
        }
    }

    // remove outer the <li> </li>
    return html.slice(4, -5);
}

/**
 * A render function that doesn't do any remapping!
 *
 * @param node
 * @param parentNode
 * @returns {string}
 */
function simpleRender(node, parentNode) {
    // extract class and method names from the node
    const className = node["className"];
    const methodName = node["methodName"];
    if (!className || !methodName) {
        return escapeHtml(node["name"]);
    }

    return escapeHtml(className) + '.' + escapeHtml(methodName) + '()';
}

/**
 * Does the remapping work for the Bukkit rendering function.
 *
 * @param node the node
 * @param parentNode the parent node
 * @param mcpMappings mcp mapping data
 * @param bukkitMappings bukkit mapping data
 * @param nmsVersion the nms version used
 * @returns {string}
 */
function doBukkitRemapping(node, parentNode, mcpMappings, bukkitMappings, nmsVersion) {
    // extract class and method names from the node
    const className = node["className"];
    const methodName = node["methodName"];
    if (!className || !methodName) {
        return escapeHtml(node["name"]);
    }

    // define a fallback name to describe the method in case we can't remap it.
    const name = escapeHtml(className) + '.' + escapeHtml(methodName) + '()';

    // only remap nms classes
    if (!className.startsWith("net.minecraft.server." + nmsVersion + ".")) {
        return name;
    }

    // get the nms name of the class
    const nmsClassName = className.substring(("net.minecraft.server." + nmsVersion + ".").length);

    // try to find bukkit mapping data for the class
    let bukkitClassData = bukkitMappings["classes"][nmsClassName];
    if (nmsClassName === "MinecraftServer") {
        bukkitClassData = bukkitMappings["classes"]["net.minecraft.server.MinecraftServer"];
    }

    if (!bukkitClassData) {
        return name;
    }

    // get the obfuscated name of the class
    const obfuscatedClassName = bukkitClassData["obfuscated"];

    // try to obtain mcp mappings for the now obfuscated class
    const mcpClassData = mcpMappings["classes"][obfuscatedClassName];
    if (!mcpClassData) {
        return name;
    }

    // we have a mcp name for the class
    // now attempt to remap the method

    // if bukkit has already provided a mapping for this method, just return.
    for (const method of bukkitClassData["methods"]) {
        if (method["bukkitName"] === methodName) {
            return name;
        }
    }

    // find MCP methods where the obfuscated name matches the method we're trying to remap.
    let mcpMethods = [];
    for (const mcpMethod of mcpClassData["methods"]) {
        if (mcpMethod["obfuscated"] === methodName) {
            mcpMethods.push(mcpMethod);
        }
    }

    // didn't find anything...
    if (!mcpMethods) {
        return name;
    }

    if (mcpMethods.length === 1) {
        // we got lucky - there was only one MCP method with the same name ;>
        const mappedMethodName = mcpMethods[0]["mcpName"];
        return escapeHtml(className) + '.<span class="remapped" title="' + methodName + '">' + escapeHtml(mappedMethodName) + '</span>()';
    }

    // ok, so at this point:
    // we have a number of candidate deobfuscated MCP methods (all having the same obfuscated method name
    // as the method we're trying to remap) - we just don't know which to choose.
    // e.g. 'setValue(String val)' and 'setValue(int val)' have the same method name, but are different methods.
    // we can attempt to work out which one we want by matching the method descriptions.

    // if method description info isn't available, give up.
    const methodDesc = node["methodDesc"];
    if (!methodDesc) {
        return name;
    }

    // iterate through our candicate methods
    for (const mcpMethod of mcpMethods) {
        // get the obfuscated description of the method
        const obfucsatedDesc = mcpMethod["description"];

        // generate the deobfucscated description for the method (obf mojang --> bukkit)
        const deobfucsatedDesc = obfucsatedDesc.replace(/L([^;]+);/g, function(match) {
            // the obfuscated type name
            const obfType = match.substring(1, match.length - 1);

            // find the mapped bukkit class for the obf'd type.
            const classes = bukkitMappings["classes"];
            for (const mappedClass in classes) {
                if (!classes.hasOwnProperty(mappedClass)) {
                    continue;
                }
                const bukkitMapping = bukkitMappings["classes"][mappedClass];
                if (bukkitMapping["obfuscated"] === obfType) {
                    return "L" + "net/minecraft/server/" + nmsVersion + "/" + mappedClass + ";";
                }
            }
            return match;
        });

        // if the description of the method we're trying to remap matches the converted
        // description of the MCP method, we have a match...
        if (methodDesc === deobfucsatedDesc) {
            const mappedMethodName = mcpMethod["mcpName"];
            return escapeHtml(className) + '.<span class="remapped" title="' + methodName + '">' + escapeHtml(mappedMethodName) + '</span>()';
        }
    }

    return name;
}

/**
 * Does the remapping work for the MCP rendering function.
 *
 * @param node the node
 * @param mcpMappings mcp mapping data
 * @returns {string}
 */
function doMcpRemapping(node, mcpMappings) {
    // extract class and method names from the node
    const className = node["className"];
    const methodName = node["methodName"];
    if (!className || !methodName) {
        return escapeHtml(node["name"]);
    }

    const mcpMethodName = mcpMappings["methods"][methodName];
    if (mcpMethodName && $.type(mcpMethodName) === "string") {
        return escapeHtml(className) + '.<span class="remapped" title="' + methodName + '">' + escapeHtml(mcpMethodName) + '</span>()';
    }
    return escapeHtml(className) + '.' + escapeHtml(methodName) + '()';
}

/**
 * Does the remapping work for the Yarn rendering function.
 *
 * @param node the node
 * @param yarnMappings yarn mapping data
 * @returns {string}
 */
function doYarnRemapping(node, yarnMappings) {
    // extract class and method names from the node
    const className = node["className"];
    const methodName = node["methodName"];
    if (!className || !methodName) {
        return escapeHtml(node["name"]);
    }

    const yarnClassName = yarnMappings["classes"][className];
    const yarnMethodName = yarnMappings["methods"][methodName];

    let out = "";

    if (yarnClassName && typeof(yarnClassName) === "string") {
        out += '<span class="remapped" title="' + className + '">' + escapeHtml(yarnClassName) + '</span>';
    } else {
        out += escapeHtml(className);
    }
    out += ".";
    if (yarnMethodName && typeof(yarnMethodName) === "string") {
        out += '<span class="remapped" title="' + methodName + '">' + escapeHtml(yarnMethodName) + '</span>';
    } else {
        out += escapeHtml(methodName);
    }

    return out + "()";
}

function applyRemapping(type) {
    $sampler.hide();
    $overlay.empty();
    $loading.show().html("Remapping data; please wait...");

    if (type.startsWith("bukkit")) {
        const version = type.substring("bukkit-".length);
        const nmsVersion = mappingsInfo["bukkit"]["versions"][version]["nmsVersion"];

        $.getJSON(MAPPING_DATA_URL + version + "/mcp.json", function(mcpMappings) {
            $.getJSON(MAPPING_DATA_URL + version + "/bukkit.json", function(bukkitMappings) {
                const renderingFunction = function(node, parentNode) {
                    return doBukkitRemapping(node, parentNode, mcpMappings, bukkitMappings, nmsVersion);
                };

                renderData(activeData, renderingFunction)
            });
        });
    } else if (type.startsWith("mcp")) {
        const version = type.substring("mcp-".length);

        $.getJSON(MAPPING_DATA_URL + version + "/mcp.json", function(mcpMappings) {
            const renderingFunction = function(node, parentNode) {
                return doMcpRemapping(node, mcpMappings);
            };

            renderData(activeData, renderingFunction)
        });
    } else if (type.startsWith("yarn")) {
        const version = type.substring("yarn-".length);

        $.getJSON(MAPPING_DATA_URL + version + "/yarn.json", function(yarnMappings) {
            const renderingFunction = function(node, parentNode) {
                return doYarnRemapping(node, yarnMappings);
            };

            renderData(activeData, renderingFunction)
        });
    } else {
        setTimeout(function() {
            renderData(activeData, simpleRender);
        }, 0);
    }
}

function renderMappingsSelector(mappings) {
    let html = '<select title="mappings">';
    html += '<optgroup label="None"><option value="none">No mappings</option></optgroup>';

    for (const mappingId in mappings) {
        const mapping = mappings[mappingId];
        const name = mapping["name"];
        const format = mapping["format"];

        html += '<optgroup label="' + name + '">';
        const versions = mapping["versions"];
        for (const versionId in versions) {
            const version = versions[versionId];
            const name = version["name"];
            const display = format.replace("%s", name);
            html += '<option value="' + mappingId + '-' + versionId + '">' + display + '</option>';
        }
        html += '</optgroup>';
    }

    html += '</select>';
    return html;
}

function applyFilters(filter) {
    $sampler.hide();
    $overlay.empty();
    $loading.show().html("Applying filter; please wait...");

    setTimeout(function() {
        const stacks = $("#stack > .node");
        for (const stack of stacks) {
            applyFilter(filter, $(stack));
        }
        $sampler.show();
        $loading.hide();
    }, 0);
}

function applyFilter(filter, element) {
    // element is a div, with class "node"
    const children = element.children("ul").children("li").children(".node");

    // check if "this" element should be shown.
    let show = filter === null || element.attr("data-name").toLowerCase().includes(filter.toLowerCase());

    if (show) {
        // if this element should be shown, pass that onto all children & make them shown.
        for (const child of children) {
            applyFilter(null, $(child));
        }
    } else {
        // check to see if any of our children match the filter
        for (const child of children) {
            if (applyFilter(filter, $(child))) {
                show = true;
            }
        }
    }

    // show the element if necessary.
    let parent = element.parent();
    if (parent.attr("id") === "stack") {
        parent = element;
    }
    if (show) {
        parent.show();
    } else {
        parent.hide();
    }

    return show;
}


/*
 * Define page listeners.
 * These will be evaluated before any content has actually been rendered and added to the page.
 */

// utility functions for manipulating the stack view.
function expandTree(parent) {
    parent.removeClass("collapsed");
    const list = parent.children("ul");
    list.slideDown(50);

    // if the element we've just expanded only has one child, expand that too (recursively)
    const children = list.children("li");
    if (children.length === 1) {
        const onlyChild = children.children(".node");
        expandTree(onlyChild); // recursive call
    }
}
function expandEntireTree(node) {
    node.find("ul").show();
    node.find(".node").addBack().removeClass("collapsed");
}
function collapseEntireTree(node) {
    node.find("ul").hide();
    node.find(".node").addBack().addClass("collapsed");
    $overlay.empty();
}
function expandAll() {
    expandEntireTree($stack);
}
function collapseAll() {
    collapseEntireTree($stack);
}

// click node --> expand/collapse
$stack.on("click", ".name", function(e) {
    const parent = $(this).parent();
    if (parent.hasClass("collapsed")) {
        expandTree(parent);
    } else {
        parent.addClass("collapsed");
        parent.children("ul").slideUp(50);
    }
});

// hover over node --> highlight and show time
$stack.on("mouseenter", ".name", function(e) {
    // ignore hover changes when the context menu is active
    if (contextMenuActive()) {
        return;
    }

    // mark the current element as hovered
    $(this).addClass("hovered");

    // clear the overlay
    $overlay.empty();

    // render updated overlay
    let totalTime = null;
    $(this).parents(".node").each(function(i, element) {
        const parent = $(element);
        const time = parseInt(parent.children(".name").children(".time").text().replace(/[^0-9]/, ""));
        
        if (totalTime == null) {
            totalTime = time;
        } else {
            const span = $(document.createElement("span"));
            const pos = parent.position();
            span.text(((totalTime / time) * 100).toFixed(2) + "%");
            span.css({
                top: pos.top + "px"
            });
            $overlay.append(span);
        }
    });
});
$stack.on("mouseleave", ".name", function(e) {
    // if the parent node is the context menu target, don't remove the hover yet.
    if (this.parentNode === contextMenuTarget) {
        return;
    }
    $(this).removeClass("hovered");
});

// context menu handling
const contextMenu = $("#stack-context-menu");
let contextMenuTarget;

function hideContextMenu() {
    if (contextMenuActive()) {
        contextMenu.hide();
        $(contextMenuTarget).children(".name").removeClass("hovered");
        contextMenuTarget = null;
        return true;
    }
    return false;
}

function contextMenuActive() {
    return contextMenu.css("display") !== "none";
}

// listen for context menu open
$stack.contextmenu(function(e) {
    // if the context menu is already open, close it & return.
    if (hideContextMenu()) {
        e.preventDefault();
        return;
    }

    // determine the target of the context menu
    contextMenuTarget = $(e.target).closest(".node");
    contextMenuTarget.addClass("hovered");
    contextMenuTarget = contextMenuTarget.get()[0];

    // if no target was found, return
    if (!contextMenuTarget) {
        return;
    }
    
    // cancel the default action & render our custom menu
    e.preventDefault();
    contextMenu.css({
        left: `${e.pageX}px`,
        top: `${e.pageY}px`
    });
    contextMenu.toggle(300);
});
// handle click events within the context menu
contextMenu.click(function(e) {
    const target = $(e.target);
    const action = target.attr("data-action");
    if (action === "expand") {
        expandEntireTree($(contextMenuTarget));
    } else if (action === "collapse") {
        collapseEntireTree($(contextMenuTarget));
    } else if (action === "expand-all") {
        expandAll();
    } else if (action === "collapse-all") {
        collapseAll();
    }
});
// close the menu when the cursor is clicked elsewhere.
$(window).click(function(e) {
    hideContextMenu();
});
// close the menu when the escape key is pressed.
$(document).keyup(function(e) {
    if (e.key === "Escape") {
        hideContextMenu();
    }
});

// listen for filter box submissions
$("#sampler > .filter-input-box").keyup(function(e) {
    if (e.keyCode === 13) {
        let value = this.value;
        if (value === "") {
            value = null;
        }
        applyFilters(value);
    }
});
