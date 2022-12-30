import { vec3 } from "gl-matrix";

export const sphere = (radius: number, sectors: number, stacks: number) => {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const tangents: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < stacks; ++i) {
        const phi = -Math.PI / 2 + Math.PI * (i / (stacks - 1));
        const y = radius * Math.sin(phi);

        for (let j = 0; j <= sectors; ++j) {
            const theta = 2 * Math.PI * (j / sectors);

            const x = radius * Math.cos(phi) * Math.cos(theta);
            const z = radius * Math.cos(phi) * Math.sin(theta);

            positions.push(x, y, z);
            normals.push(x / radius, y / radius, z / radius);
            uvs.push(1 - j / sectors, i / (stacks - 1));

            const thetaNext = 2 * Math.PI * ((j + 1) / sectors);
            const xNext = radius * Math.cos(phi) * Math.cos(thetaNext);
            const zNext = radius * Math.cos(phi) * Math.sin(thetaNext);

            const tangentLen = Math.sqrt(
                (xNext - x) * (xNext - x) + (zNext - z) * (zNext - z)
            );
            tangents.push(
                (xNext - x) / tangentLen,
                0,
                (zNext - z) / tangentLen
            );

            if (j != sectors && i != stacks - 1) {
                indices.push(
                    // first tri
                    j + i * (sectors + 1),
                    j + (i + 1) * (sectors + 1),
                    j + 1 + i * (sectors + 1),

                    //second tri
                    j + 1 + i * (sectors + 1),
                    j + (i + 1) * (sectors + 1),
                    j + 1 + (i + 1) * (sectors + 1)
                );
            }
        }
    }

    return {
        positions,
        normals,
        uvs,
        tangents,
        indices,
    };
};

export const cone = (radius: number, resolution: number) => {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const tangents: number[] = [];
    const indices: number[] = [];
    resolution = Math.floor(resolution);

    // bottom face
    const slice = (2 * Math.PI) / resolution;
    for (let i = 0; i < resolution; ++i) {
        const x = radius * Math.cos(slice * i);
        const z = radius * Math.sin(slice * i);

        positions.push(x, -0.5, z);
        normals.push(0, -1, 0);
        uvs.push((x + 1) / 2, (z + 1) / 2);
        tangents.push(1, 0, 0);
        indices.push((i + 1) % resolution, resolution, i);
    }

    // bottom face center
    positions.push(0, -0.5, 0);
    normals.push(0, -1, 0);
    uvs.push(0.5, 0.5);
    tangents.push(1, 0, 0);

    const bodyNormalY = Math.sin(Math.PI / 2 - Math.atan2(1, radius));

    // body
    const current = resolution + 1;
    for (let i = 0; i <= resolution; ++i) {
        const cos = Math.cos(slice * i);
        const sin = Math.sin(slice * i);
        const x = radius * cos;
        const z = radius * sin;
        const xNext = radius * Math.cos(slice * (i + 1));
        const zNext = radius * Math.sin(slice * (i + 1));

        positions.push(x, -0.5, z);
        positions.push(0, 0.5, 0);

        const normal = vec3.fromValues(cos, bodyNormalY, sin);
        vec3.normalize(normal, normal);

        normals.push(...normal);
        normals.push(0, 1, 0);

        const tangent = vec3.fromValues(xNext - x, 0, zNext - z);
        vec3.normalize(tangent, tangent);

        tangents.push(...tangent);
        tangents.push(...tangent);

        uvs.push(i / resolution, 1);
        uvs.push(0.5, 0.5);

        if (i != resolution) {
            indices.push(
                i * 2 + current,
                i * 2 + 1 + current,
                i * 2 + 2 + current
            );
        }
    }

    return {
        positions,
        normals,
        uvs,
        tangents,
        indices,
    };
};

export const torus = (
    radius: number,
    innerRadius: number,
    sectors: number,
    stacks: number
) => {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const tangents: number[] = [];
    const indices: number[] = [];

    const slice = (2 * Math.PI) / sectors;

    for (let i = 0; i <= sectors; ++i) {
        const x = radius * Math.cos(slice * i);
        const z = radius * Math.sin(slice * i);
        const xNext = radius * Math.cos((i + 1) * slice);
        const zNext = radius * Math.sin((i + 1) * slice);

        const centerPosition = vec3.fromValues(x, 0, z);

        const xAxis = vec3.fromValues(xNext - x, 0, zNext - z);
        vec3.normalize(xAxis, xAxis);

        const yAxis = vec3.fromValues(0, 1, 0);
        const zAxis = vec3.create();
        vec3.cross(zAxis, xAxis, yAxis);

        for (let j = 0; j <= stacks; ++j) {
            const stackSlice = (2 * Math.PI) / stacks;
            const localZAxis = vec3.create();
            const localYAxis = vec3.create();
            const zScale = innerRadius * Math.sin(j * stackSlice);
            const yScale = innerRadius * Math.cos(j * stackSlice);

            vec3.scale(localZAxis, zAxis, zScale);
            vec3.scale(localYAxis, yAxis, yScale);

            const offset = vec3.clone(localZAxis);
            vec3.add(offset, offset, localYAxis);

            const vertex = vec3.clone(centerPosition);
            vec3.add(vertex, vertex, offset);

            positions.push(...vertex);
            vec3.normalize(offset, offset);
            normals.push(...offset);

            uvs.push(i / sectors, j / stacks);
            tangents.push(...xAxis);

            if (i != 0 && j != 0) {
                const vIndex = i * (stacks + 1) + j;
                indices.push(
                    vIndex - 1,
                    vIndex - stacks - 1,
                    vIndex,

                    vIndex - stacks - 2,
                    vIndex - stacks - 1,
                    vIndex - 1
                );
            }
        }
    }

    return {
        positions,
        normals,
        uvs,
        tangents,
        indices,
    };
};

export const cube = () => {
    const DATA_PER_VERTEX = 6;

    // prettier-ignore
    const data = [
        // Front face
        -1, -1,  1,  0, 0, 1,
        1, -1,  1,   0, 0, 1,
        1,  1,  1,   0, 0, 1,
        -1,  1,  1,  0, 0, 1,

        // Back face
        -1, -1, -1,  0, 0, -1,
        -1,  1, -1,  0, 0, -1,
        1,  1, -1,   0, 0, -1,
        1, -1, -1,   0, 0, -1,

        // Top face
        -1,  1, -1,  0, 1, 0,
        -1,  1,  1,  0, 1, 0,
        1,  1,  1,   0, 1, 0,
        1,  1, -1,   0, 1, 0,

        // Bottom face
        -1, -1, -1,  0, -1, 0,
        1, -1, -1,   0, -1, 0,
        1, -1,  1,   0, -1, 0,
        -1, -1,  1,  0, -1, 0,

        // Right face
        1, -1, -1,   1, 0, 0,
        1,  1, -1,   1, 0, 0,
        1,  1,  1,   1, 0, 0,
        1, -1,  1,   1, 0, 0,

        // Left face
        -1, -1, -1,  -1, 0, 0,
        -1, -1,  1,  -1, 0, 0,
        -1,  1,  1,  -1, 0, 0,
        -1,  1, -1,  -1, 0, 0,
    ];

    // prettier-ignore
    const indices = [
        0,  1,  2,      0,  2,  3,    // front
        4,  5,  6,      4,  6,  7,    // back
        8,  9,  10,     8,  10, 11,   // top
        12, 13, 14,     12, 14, 15,   // bottom
        16, 17, 18,     16, 18, 19,   // right
        20, 21, 22,     20, 22, 23,   // left
    ];

    const positions: number[] = [];
    const normals: number[] = [];
    for (let i = 0; i < data.length; i += DATA_PER_VERTEX) {
        positions.push(...data.slice(i, i + 3));
        normals.push(...data.slice(i + 3, i + 6));
    }

    return {
        positions,
        normals,
        indices,
    };
};

export const plane = () => {
    const positions = [
        0.5, 0.5, 0.0, 0.5, -0.5, 0.0, -0.5, -0.5, 0.0, -0.5, 0.5, 0.0,
    ];
    const uvs = [1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0];
    const normals = [
        0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,
    ];

    const indices = [2, 1, 0, 2, 0, 3];

    const tangents = [
        1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0,
    ];

    return {
        positions,
        normals,
        uvs,
        tangents,
        indices,
    };
};
