/* -*- mode: javascript; tab-width: 4; insert-tabs-mode: nil; indent-tabs-mode: nil -*- */

// TODO: implement bitmap fills, morphing, filled and non-scaling strokes

/** @const */ var FILL_SOLID                        = 0;
/** @const */ var FILL_LINEAR_GRADIENT              = 16;
/** @const */ var FILL_RADIAL_GRADIENT              = 18;
/** @const */ var FILL_FOCAL_RADIAL_GRADIENT        = 19;
/** @const */ var FILL_REPEATING_BITMAP             = 64;
/** @const */ var FILL_CLIPPED_BITMAP               = 65;
/** @const */ var FILL_NONSMOOTHED_REPEATING_BITMAP = 66;
/** @const */ var FILL_NONSMOOTHED_CLIPPED_BITMAP   = 67;

function morph(start, end) {
  return start + (end ? '*' + (end / start / 0xffff) + '*r' : '');
}

function colorToRgba(color, colorMorph) {
  if (colorMorph) {
    return 'rgba(' + [
      morph(color.red, colorMorph.red),
      morph(color.green, colorMorph.green),
      morph(color.blue, colorMorph.blue),
      morph(color.alpha / 255, colorMorph.alpha / 255)
    ].join(',') + ')';
  }
  return 'rgba(' + [
    color.red,
    color.green,
    color.blue,
    color.alpha / 255
  ].join(',') + ')';
}

function matrixToTransform(matrix, matrixMorph) {
  if (matrixMorph) {
    return 'transform(' + [
      morph(matrix.scaleX * 20, matrixMorph.scaleX * 20),
      morph(matrix.scaleY * 20, matrixMorph.scaleY * 20),
      morph(matrix.skew0 * 20, matrixMorph.skew0 * 20),
      morph(matrix.skew1 * 20, matrixMorph.skew1 * 20),
      morph(matrix.translateX, matrixMorph.translateX),
      morph(matrix.translateY, matrixMorph.translateY)
    ].join(',') + ')';
  }
  return 'transform(' + [
    matrix.scaleX * 20,
    matrix.skew0 * 20,
    matrix.skew1 * 20,
    matrix.scaleY * 20,
    matrix.translateX,
    matrix.translateY
  ].join(',') + ')';
}

function joinCmds() {
  return this.cmds.join(';');
}

function ShapeFactory(graph) {
  var records = graph.records;
  var isMorph = graph.isMorph;
  var recordsMorph = isMorph ? graph.recordsMorph : [];
  var fillStyles = graph.fillStyles;
  var lineStyles = graph.lineStyles;
  var fillOffset = 0;
  var lineOffset = 0;
  var sx = 0;
  var sy = 0;
  var dx = 0;
  var dy = 0;
  var sxm = 0;
  var sym = 0;
  var dxm = 0;
  var dym = 0;
  var dpt = '0,0';
  var fill0 = 0;
  var fill1 = 0;
  var line = 0;
  var fillSegments = { };
  var lineEdges = { };
  var edges = [];
  for (var i = 0, record; record = records[i]; ++i) {
    if (isMorph)
      var recordMorph = recordsMorph[i];
    if (record.type) {
      sx = dx;
      sy = dy;
      sxm = dxm;
      sym = dym;
      var edge = { i: i, spt: dpt };
      if (record.isStraight) {
        if (record.isGeneral) {
          dx += record.deltaX;
          dy += record.deltaY;
          if (isMorph) {
            dxm += recordMorph.deltaX;
            dym += recordMorph.deltaY;
          }
        } else if (record.isVertical) {
          dy += record.deltaY;
          if (isMorph)
            dym += recordMorph.deltaY;
        } else {
          dx += record.deltaX;
          if (isMorph)
            dxm += recordMorph.deltaX;
        }
      } else {
        var cx = sx + record.controlDeltaX;
        var cy = sy + record.controlDeltaY;
        dx = cx + record.anchorDeltaX;
        dy = cy + record.anchorDeltaY;
        if (isMorph) {
          var cxm = sxm + recordMorph.controlDeltaX;
          var cym = sym + recordMorph.controlDeltaY;
          dxm = cxm + recordMorph.anchorDeltaX;
          dym = cym + recordMorph.anchorDeltaY;
          edge.cpt = morph(cx, cxm) + ',' + morph(cy, cym);
        } else {
          edge.cpt = cx + ',' + cy;
        }
      }
      if (isMorph)
        dpt = morph(dx, dxm) + ',' + morph(dy, dym);
      else
        dpt = dx + ',' + dy;
      edge.dpt = dpt;
      edges.push(edge);
    } else {
      if (edges.length) {
        if (fill0) {
          var list = fillSegments[fillOffset + fill0];
          if (!list)
            list = fillSegments[fillOffset + fill0] = [];
          list.push({
            i: i,
            spt: edges[0].spt,
            dpt: dpt,
            edges: edges
          });
        }
        if (fill1) {
          var list = fillSegments[fillOffset + fill1];
          if (!list)
            list = fillSegments[fillOffset + fill1] = [];
          list.push({
            i: i,
            spt: edges[edges.length - 1].dpt,
            dpt: edges[0].spt,
            edges: edges,
            flip: true
          });
        }
        if (line) {
          var list = lineEdges[lineOffset + line];
          if (!list)
            list = lineEdges[lineOffset + line] = [];
          push.apply(list, edges);
        }
        edges = [];
      }
      if (record.eos)
        break;
      if (record.hasNewStyles) {
        fillOffset = fillStyles.length;
        lineOffset = lineStyles.length;
        push.apply(fillStyles, record.fillStyles);
        push.apply(lineStyles, record.lineStyles);
      }
      if (record.hasFillStyle0)
        fill0 = record.fillStyle0;
      if (record.hasFillStyle1)
        fill1 = record.fillStyle1;
      if (record.hasLineStyle)
        line = record.lineStyle;
      if (record.move) {
        dx = record.moveX;
        dy = record.moveY;
        if (isMorph) {
          dxm = recordMorph.moveX;
          dym = recordMorph.moveY;
          dpt = morph(dx, dxm) + ',' + morph(dy, dym);
        } else {
          dpt = dx + ',' + dy;
        }
      }
    }
  }
  var paths = [];
  var i = 0;
  while (fillStyles[i++]) {
    var path = [];
    var segments = fillSegments[i];
    if (!segments)
      continue;
    var map = { };
    var segment;
    var j = 0;
    while (segment = segments[j++]) {
      var list = map[segment.spt];
      if (!list)
        list = map[segment.spt] = [];
      list.push(segment);
    }
    var numSegments = segments.length;
    var count = 0;
    var j = 0;
    while ((segment = segments[j++]) && count < numSegments) {
      if (segment.skip)
        continue;
      var subpath = [segment];
      segment.skip = true;
      ++count;
      var spt = segment.spt;
      var dpt = segment.dpt;
      var list = map[spt];
      var k = list.length;
      while (k--) {
        if (list[k] === segment) {
          list.splice(k, 1);
          break;
        }
      }
      while (dpt !== spt && (list = map[dpt]) != false) {
        segment = list.shift();
        subpath.push(segment);
        segment.skip = true;
        ++count;
        dpt = segment.dpt;
      }
      push.apply(path, subpath);
    }
    if (path.length) {
      var cmds = [];
      var fillStyle = fillStyles[i - 1];
      cmds.push('beginPath()');
      var prev = { };
      var j = 0;
      var subpath;
      while (subpath = path[j++]) {
        if (subpath.spt !== prev.dpt)
          cmds.push('moveTo(' + subpath.spt + ')');
        var edges = subpath.edges;
        if (subpath.flip) {
          var k = edges.length;
          var edge;
          while (edge = edges[--k]) {
            if (edge.cpt)
              cmds.push('quadraticCurveTo(' + edge.cpt + ',' + edge.spt + ')');
            else
              cmds.push('lineTo(' + edge.spt + ')');
          }
        } else {
          var k = 0;
          var edge;
          while (edge = edges[k++]) {
            if (edge.cpt)
              cmds.push('quadraticCurveTo(' + edge.cpt + ',' + edge.dpt + ')');
            else
              cmds.push('lineTo(' + edge.dpt + ')');
          }
        }
        prev = subpath;
      }
      switch (fillStyle.type) {
      case FILL_SOLID:
        cmds.push('fillStyle="' + colorToRgba(fillStyle.color, fillStyle.colorMorph) + '"');
        cmds.push('fill()');
        break;
      case FILL_LINEAR_GRADIENT:
      case FILL_RADIAL_GRADIENT:
      case FILL_FOCAL_RADIAL_GRADIENT:
        if (fillStyle.type === FILL_LINEAR_GRADIENT)
          cmds.push('var g=createLinearGradient(-819.2,0,819.2,0)');
        else
          cmds.push('var g=createRadialGradient(0,0,0,0,0,819.2)');
        var j = 0;
        var record;
        while (record = fillStyle.records[j++]) {
          cmds.push('g.addColorStop(' +
                    morph(record.ratio / 255, record.ratioMorph / 255) + ',"' +
                    colorToRgba(record.color, record.colorMorph) + '")');
        }
        cmds.push('save()');
        cmds.push(matrixToTransform(fillStyle.matrix, fillStyle.matrixMorph));
        cmds.push('fillStyle=g');
        cmds.push('fill()');
        cmds.push('restore()');
        break;
      }
      paths.push({
        i: path[path.length - 1].i,
        cmds: cmds,
        toString: joinCmds
      });
    }
  }
  var i = 0;
  while (lineStyles[i++]) {
    var cmds = [];
    var edges = lineEdges[i];
    if (edges) {
      var lineStyle = lineStyles[i - 1];
      cmds.push('beginPath()');
      var j = 0;
      var prev = { };
      var edge;
      while (edge = edges[j++]) {
        if (edge.spt !== prev.dpt)
          cmds.push('moveTo(' + edge.spt + ')');
        if (edge.cpt)
          cmds.push('quadraticCurveTo(' + edge.cpt + ',' + edge.dpt + ')');
        else
          cmds.push('lineTo(' + edge.dpt + ')');
        prev = edge;
      }
      cmds.push('strokeStyle="' + morph(lineStyle.color, lineStyle.colorMorph) + '"');
      cmds.push('lineWidth=' + morph(lineStyle.width, lineStyle.widthMorph));
      cmds.push('lineCap="round"');
      cmds.push('lineJoin="round"');
      cmds.push('stroke()');
      paths.push({
        i: edges[edges.length - 1].i,
        cmds: cmds,
        toString: joinCmds
      });
    }
  }
  paths.sort(function (a, b) {
    return a.i - b.i;
  });
  var bounds = graph.bounds;
  this.render = new Function('c,m,r',
    'with(c){' +
      'transform(m.scaleX,m.skew1,m.skew0,m.scaleY,m.translateX,m.translateY);' +
      'fillRule=mozFillRule=webkitFillRule="evenodd";' +
      paths.join(';') +
    '}'
  );
}
