// ==UserScript==
// @name         Airflow tree easy view
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Beautify airflow dags in tree view
// @author       You
// @match        http://airflow.blueshift.vpc/admin/airflow/tree*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const text_nodes = [...document.querySelectorAll("g.node > text")];

    const svg_container = document.querySelector("#svg_container");
    const svg_root = svg_container.querySelector("svg");
    //svg_root.style.border = "1px solid";

    const spaces_left = text_nodes.map((t, idx) => {
        const state_boxes = t.parentNode.querySelector("g.stateboxes");

        const t_bb = t.getBoundingClientRect();
        const state_boxes_bb = state_boxes.getBoundingClientRect();

        const space_left = state_boxes_bb.x - (t_bb.x + t_bb.width);
        //console.log(`${idx} ${t.innerHTML.substring(0, 30)} -> ${space_left}`);

        return space_left
    });

    const state_boxes_arr = text_nodes.map(t => t.parentNode.querySelector("g.stateboxes"));

    const shift_required = -1 * Math.min(0, ...spaces_left) + 20;
    //console.log(shift_required);

    const get_box_current_translate_xy = (state_box) => {
        const xy = state_box.getAttribute("transform").match(/translate\((\d+),\s*(\d+)\)/i);
        const x = parseInt(xy[1]);
        const y = parseInt(xy[2]);
        return {x, y};
    };

    const move_box = (state_box, dx, dy) => {
        let {x,y} = get_box_current_translate_xy(state_box);
        x += dx;
        y += dy;
        state_box.setAttribute("transform", `translate(${x},${y})`);
    }

    let boxes_end_x = 0;

    // move each of the state boxes depending on how much shift is required
    state_boxes_arr.forEach(state_box => {
        const bb = state_box.getBoundingClientRect();
        boxes_end_x = Math.max(boxes_end_x, bb.x + bb.width);

        move_box(state_box, shift_required, 0);
    });

    // console.log("boxes end x: " + boxes_end_x);
    const original_svg_width = boxes_end_x - svg_container.getBoundingClientRect().x;

    svg_root.style.width = original_svg_width + shift_required + 20;

    const axis = svg_container.querySelector("g.axis");
    // console.log(axis);
    // console.log(get_box_current_translate_xy(axis));
    move_box(axis, shift_required, 0);


    // draw lines
    const draw_lines = () => {
        text_nodes.forEach((t, idx) => {
            if (idx == 0) return;

            const t_bb = t.getBoundingClientRect();
            const state_box = state_boxes_arr[idx];
            const state_box_bb = state_box.getBoundingClientRect();
            const circle = t.parentNode.querySelector("circle");
            const circle_bb = circle.getBoundingClientRect();
            const ox = circle_bb.x + circle_bb.width/2;
            const line_x1 = t_bb.x + t_bb.width - ox + 8;
            const line_x2 = state_box_bb.x - ox - 8;

            //const line = document.createElement("line");
            const line = document.createElementNS("http://www.w3.org/2000/svg", 'line');
            let color = "#c1c1c1";
            if (idx % 2 == 0) {
                color = "rgb(232, 232, 232)";
            }
            line.style.stroke = color;
            line.style.strokeWidth = "1px";
            line.setAttribute("x1", line_x1);
            line.setAttribute("x2", line_x2);
            line.setAttribute("y1", 0);
            line.setAttribute("y2", 0);
            t.parentNode.appendChild(line);
        })
    }
    draw_lines();
})();